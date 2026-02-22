import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';

interface S3DeployRequest {
  action: 'deploy' | 'test';
  provider: 's3' | 'r2';
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathPrefix?: string;
  files?: Record<string, string>;
  chatId?: string;
}

/**
 * Detect MIME type from file extension.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mimeTypes: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    map: 'application/json',
    webmanifest: 'application/manifest+json',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Sign an AWS S3-compatible request using AWS Signature V4.
 * Works with both AWS S3 and Cloudflare R2.
 */
async function signS3Request(
  method: string,
  url: string,
  body: string | null,
  opts: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    service: string;
  },
): Promise<Record<string, string>> {
  const urlObj = new URL(url);
  const now = new Date();
  const dateStamp = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, '')
    .substring(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;

  // Hash the payload
  const payloadHash = body
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty string hash

  const headers: Record<string, string> = {
    host: urlObj.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  if (body) {
    headers['content-type'] = getMimeType(urlObj.pathname);
  }

  // Canonical request
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const canonicalRequest = [
    method,
    urlObj.pathname,
    urlObj.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const canonicalRequestHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest))),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHash].join('\n');

  // Signing key
  async function hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
    const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  }

  const kDate = await hmac('AWS4' + opts.secretAccessKey, dateStamp);
  const kRegion = await hmac(kDate, opts.region);
  const kService = await hmac(kRegion, opts.service);
  const kSigning = await hmac(kService, 'aws4_request');

  const signature = Array.from(new Uint8Array(await hmac(kSigning, stringToSign)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorization = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    Authorization: authorization,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = (await request.json()) as S3DeployRequest;
    const { action: deployAction, provider, endpoint, bucket, accessKeyId, secretAccessKey, region } = body;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      return json({ ok: false, error: 'Missing required S3/R2 credentials' }, { status: 400 });
    }

    // Normalize endpoint
    const baseUrl = endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`;
    const service = provider === 'r2' ? 's3' : 's3';
    const effectiveRegion = provider === 'r2' ? 'auto' : region || 'us-east-1';

    // Test connection
    if (deployAction === 'test') {
      try {
        const listUrl = `${baseUrl}/${bucket}?list-type=2&max-keys=1`;
        const headers = await signS3Request('GET', listUrl, null, {
          accessKeyId,
          secretAccessKey,
          region: effectiveRegion,
          service,
        });

        const res = await fetch(listUrl, { method: 'GET', headers });

        if (res.ok) {
          return json({ ok: true });
        }

        const errorText = await res.text();

        return json({ ok: false, error: `Connection failed (${res.status}): ${errorText.substring(0, 200)}` });
      } catch (err) {
        return json({ ok: false, error: `Connection error: ${err instanceof Error ? err.message : 'Unknown'}` });
      }
    }

    // Deploy files
    if (deployAction === 'deploy') {
      const files = body.files;

      if (!files || Object.keys(files).length === 0) {
        return json({ ok: false, error: 'No files to deploy' }, { status: 400 });
      }

      const prefix = body.pathPrefix ? body.pathPrefix.replace(/^\/|\/$/g, '') + '/' : '';
      let uploadedCount = 0;
      const errors: string[] = [];

      for (const [filePath, content] of Object.entries(files)) {
        const key = prefix + filePath.replace(/^\//, '');
        const putUrl = `${baseUrl}/${bucket}/${key}`;

        try {
          const headers = await signS3Request('PUT', putUrl, content, {
            accessKeyId,
            secretAccessKey,
            region: effectiveRegion,
            service,
          });

          headers['content-type'] = getMimeType(filePath);

          const res = await fetch(putUrl, {
            method: 'PUT',
            headers,
            body: content,
          });

          if (res.ok) {
            uploadedCount++;
          } else {
            const errorText = await res.text();
            errors.push(`${key}: ${res.status} ${errorText.substring(0, 100)}`);
          }
        } catch (err) {
          errors.push(`${key}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      if (uploadedCount === 0) {
        return json(
          { ok: false, error: `All uploads failed. Errors: ${errors.slice(0, 3).join('; ')}` },
          { status: 500 },
        );
      }

      const url = body.pathPrefix ? `${baseUrl}/${bucket}/${prefix}index.html` : `${baseUrl}/${bucket}/index.html`;

      return json({
        ok: true,
        fileCount: uploadedCount,
        totalFiles: Object.keys(files).length,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
        url,
      });
    }

    return json({ ok: false, error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
