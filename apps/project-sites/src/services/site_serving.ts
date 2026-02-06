import { DOMAINS, BRAND } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';

/**
 * Top bar HTML injected for unpaid sites.
 * Minimal, non-intrusive, with call-to-action.
 */
export function generateTopBar(slug: string): string {
  return `<!-- Project Sites Top Bar -->
<div id="ps-topbar" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#1a1a2e;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
  <span>This site is powered by <a href="https://${DOMAINS.SITES_BASE}" style="color:#64ffda;text-decoration:none;font-weight:600">Project Sites</a></span>
  <span style="display:flex;gap:12px;align-items:center">
    <a href="https://${DOMAINS.SITES_BASE}/?upgrade=${encodeURIComponent(slug)}" style="background:#64ffda;color:#1a1a2e;padding:4px 12px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px">${BRAND.PRIMARY_CTA}</a>
    <a href="javascript:void(0)" onclick="document.getElementById('ps-topbar').style.display='none';document.body.style.paddingTop='0'" style="color:#aaa;font-size:18px;text-decoration:none" aria-label="Close">&times;</a>
  </span>
</div>
<style>body{padding-top:44px !important}</style>
<!-- End Project Sites Top Bar -->`;
}

/**
 * Resolve a hostname to a site.
 * Uses KV cache for fast path, falls back to DB.
 */
export async function resolveSite(
  env: Env,
  db: SupabaseClient,
  hostname: string,
): Promise<{
  site_id: string;
  slug: string;
  org_id: string;
  current_build_version: string | null;
  plan: string;
} | null> {
  // Fast path: check KV cache
  const cacheKey = `host:${hostname}`;
  const cached = await env.CACHE_KV.get(cacheKey, 'json');

  if (cached) {
    return cached as {
      site_id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
      plan: string;
    };
  }

  // Extract slug from hostname
  let slug: string | null = null;
  const baseDomain = DOMAINS.SITES_BASE;

  if (hostname.endsWith(`.${baseDomain}`)) {
    slug = hostname.replace(`.${baseDomain}`, '');
  }

  // Try hostname table lookup first (for custom domains)
  if (!slug) {
    const hostnameResult = await supabaseQuery<Array<{ site_id: string; org_id: string }>>(
      db,
      'hostnames',
      {
        query: `hostname=eq.${encodeURIComponent(hostname)}&status=eq.active&deleted_at=is.null&select=site_id,org_id`,
      },
    );

    if (hostnameResult.data?.[0]) {
      const { site_id, org_id } = hostnameResult.data[0];

      // Look up site
      const siteResult = await supabaseQuery<
        Array<{ slug: string; current_build_version: string | null }>
      >(db, 'sites', {
        query: `id=eq.${site_id}&deleted_at=is.null&select=slug,current_build_version`,
      });

      if (siteResult.data?.[0]) {
        // Look up plan
        const subResult = await supabaseQuery<Array<{ plan: string; status: string }>>(
          db,
          'subscriptions',
          { query: `org_id=eq.${org_id}&deleted_at=is.null&select=plan,status` },
        );

        const plan =
          subResult.data?.[0]?.plan === 'paid' && subResult.data[0].status === 'active'
            ? 'paid'
            : 'free';

        const resolved = {
          site_id,
          slug: siteResult.data[0].slug,
          org_id,
          current_build_version: siteResult.data[0].current_build_version,
          plan,
        };

        // Cache for 60 seconds
        await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), {
          expirationTtl: 60,
        });

        return resolved;
      }
    }
  }

  // Look up by slug
  if (slug) {
    const siteResult = await supabaseQuery<
      Array<{
        id: string;
        slug: string;
        org_id: string;
        current_build_version: string | null;
      }>
    >(db, 'sites', {
      query: `slug=eq.${encodeURIComponent(slug)}&deleted_at=is.null&select=id,slug,org_id,current_build_version`,
    });

    if (siteResult.data?.[0]) {
      const site = siteResult.data[0];

      // Look up plan
      const subResult = await supabaseQuery<Array<{ plan: string; status: string }>>(
        db,
        'subscriptions',
        { query: `org_id=eq.${site.org_id}&deleted_at=is.null&select=plan,status` },
      );

      const plan =
        subResult.data?.[0]?.plan === 'paid' && subResult.data[0].status === 'active'
          ? 'paid'
          : 'free';

      const resolved = {
        site_id: site.id,
        slug: site.slug,
        org_id: site.org_id,
        current_build_version: site.current_build_version,
        plan,
      };

      // Cache for 60 seconds
      await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), {
        expirationTtl: 60,
      });

      return resolved;
    }
  }

  return null;
}

/**
 * Serve a site's static files from R2.
 * Injects top bar for unpaid sites.
 */
export async function serveSiteFromR2(
  env: Env,
  site: {
    site_id: string;
    slug: string;
    current_build_version: string | null;
    plan: string;
  },
  requestPath: string,
): Promise<Response> {
  const version = site.current_build_version ?? 'latest';
  const r2Path = `sites/${site.slug}/${version}${requestPath === '/' ? '/index.html' : requestPath}`;

  const object = await env.SITES_BUCKET.get(r2Path);

  if (!object) {
    // Try index.html for SPA fallback
    if (!requestPath.includes('.')) {
      const fallbackPath = `sites/${site.slug}/${version}/index.html`;
      const fallback = await env.SITES_BUCKET.get(fallbackPath);

      if (fallback) {
        return buildSiteResponse(fallback, site, 'text/html');
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  const contentType = getContentType(requestPath);
  return buildSiteResponse(object, site, contentType);
}

/**
 * Build a response for a site file, with top bar injection for HTML if unpaid.
 */
async function buildSiteResponse(
  object: R2ObjectBody,
  site: { slug: string; plan: string },
  contentType: string,
): Promise<Response> {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Site-Slug': site.slug,
  });

  // For HTML responses, inject top bar if unpaid
  if (contentType === 'text/html' && site.plan !== 'paid') {
    const html = await object.text();
    const topBar = generateTopBar(site.slug);

    // Inject after <body> tag
    const injected = html.replace(/(<body[^>]*>)/i, `$1\n${topBar}\n`);

    return new Response(injected, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}

/**
 * Get content type from file path.
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
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
    xml: 'application/xml',
    txt: 'text/plain',
    webmanifest: 'application/manifest+json',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
