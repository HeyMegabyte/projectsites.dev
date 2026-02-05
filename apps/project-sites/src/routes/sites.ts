/**
 * Site serving routes
 * Handles serving static sites from R2 with top bar injection
 */
import { Hono } from 'hono';
import { DOMAINS, PERFORMANCE, shouldShowTopBar } from '@project-sites/shared';
import type { AppContext, SiteLookup } from '../types.js';

export const siteRoutes = new Hono<AppContext>();

// =============================================================================
// Top Bar HTML (injected for unpaid sites)
// =============================================================================

const TOP_BAR_HTML = `
<!-- Project Sites Top Bar -->
<style>
  .ps-top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 40px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }
  .ps-top-bar a {
    color: #60a5fa;
    text-decoration: none;
  }
  .ps-top-bar a:hover {
    text-decoration: underline;
  }
  .ps-top-bar-cta {
    background: #3b82f6;
    color: white !important;
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 500;
  }
  .ps-top-bar-cta:hover {
    background: #2563eb;
    text-decoration: none !important;
  }
  body {
    margin-top: 40px !important;
  }
</style>
<div class="ps-top-bar">
  <span>Powered by <a href="https://sites.megabyte.space" target="_blank">Project Sites</a></span>
  <a href="https://sites.megabyte.space/upgrade" class="ps-top-bar-cta">Remove this bar</a>
</div>
<!-- End Project Sites Top Bar -->
`;

// =============================================================================
// Helpers
// =============================================================================

async function getSiteLookup(
  hostname: string,
  kv: KVNamespace,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<SiteLookup | null> {
  // Try KV cache first
  const cacheKey = `host:${hostname}`;
  const cached = await kv.get<SiteLookup>(cacheKey, 'json');

  if (cached) {
    return cached;
  }

  // Extract slug from hostname
  // e.g., "business-name.sites.megabyte.space" -> "business-name"
  let slug: string | null = null;

  if (hostname.endsWith(`.${DOMAINS.FREE_SITE_BASE}`)) {
    slug = hostname.replace(`.${DOMAINS.FREE_SITE_BASE}`, '');
  } else if (hostname.endsWith(`.${DOMAINS.STAGING_BASE}`)) {
    slug = hostname.replace(`.${DOMAINS.STAGING_BASE}`, '');
  }

  // Query Supabase for site info
  let siteData: SiteLookup | null = null;

  if (slug) {
    // Query by slug for subdomain
    const response = await fetch(
      `${supabaseUrl}/rest/v1/sites?slug=eq.${encodeURIComponent(slug)}&select=id,slug,r2_prefix,current_build_version,org_id,orgs(subscription_status)`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (response.ok) {
      const sites = (await response.json()) as Array<{
        id: string;
        slug: string;
        r2_prefix: string;
        current_build_version: string | null;
        org_id: string;
        orgs: { subscription_status: string };
      }>;

      if (sites[0]) {
        siteData = {
          site_id: sites[0].id,
          slug: sites[0].slug,
          r2_prefix: sites[0].r2_prefix,
          current_build_version: sites[0].current_build_version,
          is_paid: sites[0].orgs.subscription_status === 'active',
          org_id: sites[0].org_id,
          ttl: PERFORMANCE.HOSTNAME_CACHE_TTL_SECONDS,
        };
      }
    }
  } else {
    // Query by custom hostname
    const response = await fetch(
      `${supabaseUrl}/rest/v1/hostnames?hostname=eq.${encodeURIComponent(hostname)}&status=eq.active&select=site_id,sites(id,slug,r2_prefix,current_build_version,org_id,orgs(subscription_status))`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );

    if (response.ok) {
      const hostnames = (await response.json()) as Array<{
        site_id: string;
        sites: {
          id: string;
          slug: string;
          r2_prefix: string;
          current_build_version: string | null;
          org_id: string;
          orgs: { subscription_status: string };
        };
      }>;

      if (hostnames[0]?.sites) {
        const site = hostnames[0].sites;
        siteData = {
          site_id: site.id,
          slug: site.slug,
          r2_prefix: site.r2_prefix,
          current_build_version: site.current_build_version,
          is_paid: site.orgs.subscription_status === 'active',
          org_id: site.org_id,
          ttl: PERFORMANCE.HOSTNAME_CACHE_TTL_SECONDS,
        };
      }
    }
  }

  // Cache the result
  if (siteData) {
    await kv.put(cacheKey, JSON.stringify(siteData), {
      expirationTtl: siteData.ttl,
    });
  }

  return siteData;
}

function injectTopBar(html: string): string {
  // Inject after <body> tag
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (bodyMatch) {
    const insertPos = (bodyMatch.index ?? 0) + bodyMatch[0].length;
    return html.slice(0, insertPos) + TOP_BAR_HTML + html.slice(insertPos);
  }
  // Fallback: prepend to document
  return TOP_BAR_HTML + html;
}

// =============================================================================
// Site Serving Route
// =============================================================================

siteRoutes.get('*', async (c) => {
  const hostname = c.req.header('Host') ?? '';
  const path = new URL(c.req.url).pathname;

  // Skip API and health routes
  if (path.startsWith('/api') || path.startsWith('/health') || path.startsWith('/_health')) {
    return c.notFound();
  }

  // Skip webhooks
  if (path.startsWith('/webhooks')) {
    return c.notFound();
  }

  // Get site lookup
  const siteLookup = await getSiteLookup(
    hostname,
    c.env.CACHE_KV,
    c.env.SUPABASE_URL,
    c.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!siteLookup) {
    return c.html(
      `<!DOCTYPE html>
<html>
<head>
  <title>Site Not Found | Project Sites</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .container { text-align: center; padding: 40px; }
    h1 { color: #1e293b; margin-bottom: 16px; }
    p { color: #64748b; margin-bottom: 24px; }
    a { color: #3b82f6; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Site Not Found</h1>
    <p>This site doesn't exist or hasn't been published yet.</p>
    <a href="https://sites.megabyte.space">Create your own site</a>
  </div>
</body>
</html>`,
      404,
    );
  }

  // Determine file path in R2
  const buildVersion = siteLookup.current_build_version ?? 'latest';
  let filePath = path === '/' ? '/index.html' : path;

  // Normalize path
  if (!filePath.includes('.')) {
    // Assume it's a page route, try .html extension
    filePath = filePath.endsWith('/') ? `${filePath}index.html` : `${filePath}.html`;
  }

  const r2Key = `${siteLookup.r2_prefix}/${buildVersion}${filePath}`;

  // Fetch from R2
  const object = await c.env.SITES_BUCKET.get(r2Key);

  if (!object) {
    // Try index.html for SPA fallback
    const indexKey = `${siteLookup.r2_prefix}/${buildVersion}/index.html`;
    const indexObject = await c.env.SITES_BUCKET.get(indexKey);

    if (!indexObject) {
      return c.text('File not found', 404);
    }

    // Serve index.html
    let html = await indexObject.text();

    // Inject top bar if unpaid
    if (!siteLookup.is_paid) {
      html = injectTopBar(html);
    }

    return c.html(html);
  }

  // Determine content type
  const contentType = object.httpMetadata?.contentType ?? getMimeType(filePath);

  // For HTML files, potentially inject top bar
  if (contentType.includes('text/html')) {
    let html = await object.text();

    if (!siteLookup.is_paid) {
      html = injectTopBar(html);
    }

    return c.html(html);
  }

  // For other files, stream directly
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.etag,
    },
  });
});

// =============================================================================
// MIME Type Helper
// =============================================================================

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mimeTypes: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    otf: 'font/otf',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    pdf: 'application/pdf',
    webmanifest: 'application/manifest+json',
  };
  return mimeTypes[ext] ?? 'application/octet-stream';
}
