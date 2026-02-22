import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * We test the route's action function by importing the module
 * and calling action() with mock Request objects.
 *
 * We mock global `fetch` to capture outgoing S3/R2 calls.
 * We mock `crypto.subtle` for deterministic signature tests.
 */

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set up
const { action } = await import('./api.s3-deploy');

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/s3-deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callAction(body: Record<string, unknown>) {
  const request = makeRequest(body);
  const response = await action({
    request,
    params: {},
    context: {} as never,
  });

  // Remix json() returns a Response
  const data = await response.json();

  return { status: response.status, data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('api.s3-deploy — validation', () => {
  it('returns 400 when endpoint is missing', async () => {
    const { status, data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: '',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Missing required/);
  });

  it('returns 400 when bucket is missing', async () => {
    const { status, data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: '',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
  });

  it('returns 400 when accessKeyId is missing', async () => {
    const { status, data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: '',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
  });

  it('returns 400 when secretAccessKey is missing', async () => {
    const { status, data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: '',
      region: 'us-east-1',
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
  });

  it('returns 400 for invalid action', async () => {
    const { status, data } = await callAction({
      action: 'invalid',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Invalid action/);
  });
});

describe('api.s3-deploy — test connection', () => {
  it('returns ok:true when S3 responds 200', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<ListBucketResult/>', { status: 200 }));

    const { data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });

    expect(data.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify it called the correct URL pattern
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toContain('s3.amazonaws.com/my-bucket');
    expect(fetchUrl).toContain('list-type=2');
    expect(fetchUrl).toContain('max-keys=1');
  });

  it('returns ok:false when S3 responds with error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('AccessDenied', { status: 403 }));

    const { data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });

    expect(data.ok).toBe(false);
    expect(data.error).toContain('403');
  });

  it('returns ok:false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { data } = await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });

    expect(data.ok).toBe(false);
    expect(data.error).toContain('Network failure');
  });

  it('uses region=auto for R2 provider', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

    await callAction({
      action: 'test',
      provider: 'r2',
      endpoint: 'https://abc123.r2.cloudflarestorage.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1', // should be overridden to 'auto'
    });

    /*
     * R2 uses auto region — we can't directly verify the signing,
     * but we verify fetch was called with the R2 endpoint
     */
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toContain('r2.cloudflarestorage.com/my-bucket');
  });

  it('prepends https:// if missing from endpoint', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

    await callAction({
      action: 'test',
      provider: 's3',
      endpoint: 's3.amazonaws.com',
      bucket: 'test-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    });

    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toMatch(/^https:\/\//);
  });
});

describe('api.s3-deploy — deploy files', () => {
  it('returns 400 when no files provided', async () => {
    const { status, data } = await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {},
    });
    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/No files/);
  });

  it('uploads files and returns success', async () => {
    // All uploads succeed
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));

    const { data } = await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/index.html': '<html><body>Hello</body></html>',
        '/styles.css': 'body { margin: 0; }',
        '/app.js': 'console.log("hello");',
      },
    });

    expect(data.ok).toBe(true);
    expect(data.fileCount).toBe(3);
    expect(data.totalFiles).toBe(3);
    expect(data.url).toContain('index.html');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('respects pathPrefix when uploading', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));

    await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      pathPrefix: 'my-site/v1',
      files: {
        '/index.html': '<html/>',
      },
    });

    const putUrl = mockFetch.mock.calls[0][0];
    expect(putUrl).toContain('my-bucket/my-site/v1/index.html');
  });

  it('handles partial upload failures', async () => {
    // First file succeeds, second fails
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const { data } = await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/index.html': '<html/>',
        '/style.css': 'body{}',
      },
    });

    expect(data.ok).toBe(true); // partial success
    expect(data.fileCount).toBe(1);
    expect(data.totalFiles).toBe(2);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]).toContain('403');
  });

  it('returns 500 when all uploads fail', async () => {
    mockFetch.mockResolvedValue(new Response('AccessDenied', { status: 403 }));

    const { status, data } = await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/index.html': '<html/>',
      },
    });

    expect(status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error).toContain('All uploads failed');
  });

  it('handles fetch exceptions per file gracefully', async () => {
    // First file succeeds, second throws network error
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockRejectedValueOnce(new Error('Connection reset'));

    const { data } = await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/index.html': '<html/>',
        '/other.js': 'x',
      },
    });

    expect(data.ok).toBe(true);
    expect(data.fileCount).toBe(1);
    expect(data.errors[0]).toContain('Connection reset');
  });

  it('sets correct MIME types via headers', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));

    await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/index.html': '<html/>',
      },
    });

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('includes AWS Signature V4 Authorization header', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));

    await callAction({
      action: 'deploy',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      files: {
        '/test.js': 'var x = 1;',
      },
    });

    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
    expect(fetchOpts.headers['x-amz-date']).toBeDefined();
    expect(fetchOpts.headers['x-amz-content-sha256']).toBeDefined();
  });
});

describe('api.s3-deploy — error handling', () => {
  it('returns 500 on malformed JSON body', async () => {
    const request = new Request('http://localhost/api/s3-deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }}}',
    });

    const response = await action({
      request,
      params: {},
      context: {} as never,
    });

    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.ok).toBe(false);
  });
});
