/**
 * @module site_serving
 * @description Static site serving engine for Project Sites.
 *
 * Resolves incoming hostnames to site records, serves static HTML/CSS/JS from
 * R2, and injects a promotional top bar for sites on the free plan.
 *
 * ## Resolution Flow
 *
 * ```
 * Request hostname
 *   ├─ KV cache hit → return cached site info
 *   ├─ Dash-based subdomain (slug-sites.megabyte.space) → lookup by slug
 *   └─ Custom domain → lookup in hostnames table → join sites → join subscriptions
 *       └─ Cache result in KV for 60 s
 * ```
 *
 * ## R2 Bucket Layout
 *
 * | Path Pattern                              | Content           |
 * | ----------------------------------------- | ----------------- |
 * | `marketing/index.html`                    | Homepage SPA      |
 * | `sites/{slug}/{version}/index.html`       | Generated site    |
 * | `sites/{slug}/{version}/privacy.html`     | Privacy policy    |
 * | `sites/{slug}/{version}/terms.html`       | Terms of service  |
 * | `sites/{slug}/{version}/research.json`    | AI research data  |
 *
 * @packageDocumentation
 */

import { DOMAINS, BRAND } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';

/**
 * Generate the promotional top bar HTML injected into unpaid sites.
 *
 * The bar is fixed to the top of the viewport, includes a CTA to upgrade,
 * and can be dismissed by the visitor (closes via inline JS).
 *
 * @param slug - The site's slug (used to build the upgrade link).
 * @returns HTML string to inject after the `<body>` tag.
 *
 * @example
 * ```ts
 * const topBar = generateTopBar('vitos-mens-salon');
 * const injected = html.replace(/(<body[^>]*>)/i, `$1\n${topBar}\n`);
 * ```
 */
export function generateTopBar(slug: string): string {
  const upgradeUrl = `https://${DOMAINS.SITES_BASE}/?upgrade=${encodeURIComponent(slug)}`;
  return `<!-- Project Sites Top Bar -->
<div id="ps-topbar" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#0f0a2e 0%,#1a1145 30%,#231660 60%,#0f0a2e 100%);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;padding:0;box-shadow:0 4px 20px rgba(0,0,0,0.4);border-bottom:1px solid rgba(124,58,237,0.3)">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;padding:10px 20px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span style="font-weight:600;font-size:12px;letter-spacing:0.02em;">Register</span>
    </div>
    <div id="ps-domain-wrap" style="position:relative;flex:1;max-width:320px;min-width:180px;">
      <input id="ps-domain-input" type="text" placeholder="Search for a domain..." style="width:100%;padding:6px 12px;border-radius:8px;border:1px solid rgba(124,58,237,0.4);background:rgba(255,255,255,0.08);color:#fff;font-size:12px;outline:none;font-family:inherit;transition:border-color 0.2s,box-shadow 0.2s" onfocus="this.style.borderColor='rgba(124,58,237,0.7)';this.style.boxShadow='0 0 12px rgba(124,58,237,0.2)'" onblur="this.style.borderColor='rgba(124,58,237,0.4)';this.style.boxShadow='none'" />
      <div id="ps-domain-results" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#1a1145;border:1px solid rgba(124,58,237,0.3);border-radius:10px;max-height:240px;overflow-y:auto;z-index:100000;box-shadow:0 12px 40px rgba(0,0,0,0.5)"></div>
    </div>
    <span style="font-size:11px;color:rgba(255,255,255,0.6);flex-shrink:0;">to claim your FREE site for</span>
    <span style="font-size:14px;font-weight:800;color:#22c55e;flex-shrink:0;">$50/month</span>
    <a href="${upgradeUrl}" id="ps-checkout-btn" style="display:inline-flex;align-items:center;gap:6px;padding:8px 20px;background:linear-gradient(135deg,#7c3aed,#50a5db);color:#fff;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 2px 12px rgba(124,58,237,0.3)" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 20px rgba(124,58,237,0.4)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 12px rgba(124,58,237,0.3)'">Get Started &#8250;</a>
    <button onclick="document.getElementById('ps-topbar').style.display='none';document.body.style.paddingTop='0'" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:0 4px;line-height:1;transition:color 0.2s" onmouseover="this.style.color='rgba(255,255,255,0.8)'" onmouseout="this.style.color='rgba(255,255,255,0.4)'" aria-label="Close">&times;</button>
  </div>
</div>
<style>body{padding-top:52px !important}#ps-domain-input::placeholder{color:rgba(255,255,255,0.35)}</style>
<script>
(function(){
  var input=document.getElementById('ps-domain-input'),wrap=document.getElementById('ps-domain-results'),timer=null;
  if(!input)return;
  input.addEventListener('input',function(){
    clearTimeout(timer);
    var q=input.value.trim();
    if(q.length<2){wrap.style.display='none';return;}
    timer=setTimeout(function(){
      fetch('https://${DOMAINS.SITES_BASE}/api/domains/search?q='+encodeURIComponent(q))
        .then(function(r){return r.json()})
        .then(function(d){
          var items=d.data||[];
          if(!items.length){wrap.style.display='none';return;}
          var h='';
          items.forEach(function(it){
            if(it.available){
              h+='<div style="padding:8px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:background 0.15s;border-bottom:1px solid rgba(255,255,255,0.05)" onmouseover="this.style.background=\\'rgba(124,58,237,0.15)\\'" onmouseout="this.style.background=\\'none\\'" onclick="document.getElementById(\\'ps-domain-input\\').value=\\''+it.domain+'\\';document.getElementById(\\'ps-domain-results\\').style.display=\\'none\\'">';
              h+='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
              h+='<span style="flex:1;font-size:12px;color:#e2e8f0">'+it.domain+'</span>';
              if(it.price>0)h+='<span style="font-size:11px;font-weight:700;color:#22c55e">$'+(it.price/100).toFixed(2)+'/yr</span>';
              h+='</div>';
            }
          });
          if(!h){wrap.style.display='none';return;}
          wrap.innerHTML=h;
          wrap.style.display='block';
        }).catch(function(){wrap.style.display='none';});
    },400);
  });
  document.addEventListener('click',function(e){if(!e.target.closest('#ps-domain-wrap'))wrap.style.display='none';});
})();
</script>
<!-- End Project Sites Top Bar -->`;
}

/**
 * Resolve a hostname to a site record.
 *
 * Uses a two-tier lookup: KV cache (60 s TTL) → D1 database.
 * Supports both dash-based subdomains (`slug-sites.megabyte.space`) and
 * custom CNAME domains (looked up in the `hostnames` table).
 *
 * @param env      - Worker environment (needs `CACHE_KV`, `DB`).
 * @param db       - D1Database binding.
 * @param hostname - The incoming request's `Host` header value.
 * @returns Resolved site info or `null` if not found.
 *
 * @example
 * ```ts
 * const site = await resolveSite(env, env.DB, 'vitos-mens-salon-sites.megabyte.space');
 * if (site) {
 *   return serveSiteFromR2(env, site, '/');
 * }
 * ```
 */
export async function resolveSite(
  env: Env,
  db: D1Database,
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
    console.warn(JSON.stringify({ level: 'debug', service: 'site_serving', message: 'KV cache hit', hostname }));
    return cached as {
      site_id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
      plan: string;
    };
  }

  // Extract slug from hostname (e.g., slug-sites.megabyte.space)
  let slug: string | null = null;

  if (hostname.endsWith(DOMAINS.SITES_SUFFIX)) {
    slug = hostname.slice(0, -DOMAINS.SITES_SUFFIX.length);
  } else if (hostname.endsWith(DOMAINS.SITES_STAGING_SUFFIX)) {
    slug = hostname.slice(0, -DOMAINS.SITES_STAGING_SUFFIX.length);
  }

  // Try hostname table lookup first (for custom domains)
  if (!slug) {
    const hostnameRow = await dbQueryOne<{ site_id: string; org_id: string }>(
      db,
      'SELECT site_id, org_id FROM hostnames WHERE hostname = ? AND status = ? AND deleted_at IS NULL',
      [hostname, 'active'],
    );

    if (hostnameRow) {
      const siteRow = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
        db,
        'SELECT slug, current_build_version FROM sites WHERE id = ? AND deleted_at IS NULL',
        [hostnameRow.site_id],
      );

      if (siteRow) {
        const subRow = await dbQueryOne<{ plan: string; status: string }>(
          db,
          'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
          [hostnameRow.org_id],
        );

        const plan =
          subRow?.plan === 'paid' && subRow.status === 'active' ? 'paid' : 'free';

        const resolved = {
          site_id: hostnameRow.site_id,
          slug: siteRow.slug,
          org_id: hostnameRow.org_id,
          current_build_version: siteRow.current_build_version,
          plan,
        };

        await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 });
        return resolved;
      }
    }
  }

  // Look up by slug
  if (slug) {
    const siteRow = await dbQueryOne<{
      id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
    }>(
      db,
      'SELECT id, slug, org_id, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug],
    );

    if (siteRow) {
      const subRow = await dbQueryOne<{ plan: string; status: string }>(
        db,
        'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
        [siteRow.org_id],
      );

      const plan =
        subRow?.plan === 'paid' && subRow.status === 'active' ? 'paid' : 'free';

      const resolved = {
        site_id: siteRow.id,
        slug: siteRow.slug,
        org_id: siteRow.org_id,
        current_build_version: siteRow.current_build_version,
        plan,
      };

      await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 });
      return resolved;
    }

    // R2 fallback: check for bolt-published sites (no D1 record)
    const manifest = await env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);

    if (manifest) {
      try {
        const data = (await manifest.json()) as { current_version: string };
        const resolved = {
          site_id: `bolt-${slug}`,
          slug,
          org_id: 'bolt-community',
          current_build_version: data.current_version,
          plan: 'free',
        };

        await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 });
        return resolved;
      } catch {
        // Malformed manifest — treat as not found
      }
    }
  }

  console.warn(JSON.stringify({ level: 'debug', service: 'site_serving', message: 'Site not found for hostname', hostname }));
  return null;
}

/**
 * Serve a site's static files from R2.
 *
 * Looks up the file at `sites/{slug}/{version}/{path}` in R2, falls back to
 * `index.html` for SPA-style routing. Injects the promotional top bar for
 * HTML responses on the free plan.
 *
 * @param env         - Worker environment (needs `SITES_BUCKET`).
 * @param site        - Resolved site info from {@link resolveSite}.
 * @param requestPath - The URL pathname (e.g. `/`, `/about`, `/style.css`).
 * @returns HTTP Response with correct content-type and caching headers.
 *
 * @example
 * ```ts
 * const response = await serveSiteFromR2(env, site, '/privacy.html');
 * ```
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
  // Block access to meta files and manifests
  if (requestPath.startsWith('/_meta/') || requestPath === '/_manifest.json') {
    console.warn(JSON.stringify({ level: 'warn', action: 'serve_blocked_path', slug: site.slug, path: requestPath }));

    return new Response('Not Found', { status: 404 });
  }

  const version = site.current_build_version ?? 'latest';
  const r2Path = `sites/${site.slug}/${version}${requestPath === '/' ? '/index.html' : requestPath}`;

  console.warn(JSON.stringify({ level: 'info', action: 'serve_site_lookup', slug: site.slug, version, r2Path }));

  const object = await env.SITES_BUCKET.get(r2Path);

  if (!object) {
    // Try index.html for SPA fallback
    if (!requestPath.includes('.')) {
      const fallbackPath = `sites/${site.slug}/${version}/index.html`;
      const fallback = await env.SITES_BUCKET.get(fallbackPath);

      if (fallback) {
        console.warn(JSON.stringify({ level: 'info', action: 'serve_spa_fallback', slug: site.slug, requestPath }));

        return buildSiteResponse(fallback, site, 'text/html; charset=utf-8');
      }
    }

    console.warn(JSON.stringify({ level: 'warn', action: 'serve_not_found', slug: site.slug, r2Path, requestPath }));

    return new Response('Not Found', { status: 404 });
  }

  // Use the resolved R2 path for content-type detection, not the raw request path.
  // Raw path '/' has no extension → would return 'application/octet-stream' (download).
  const resolvedPath = requestPath === '/' ? '/index.html' : requestPath;
  const contentType = getContentType(resolvedPath);
  return buildSiteResponse(object, site, contentType);
}

/**
 * Build an HTTP response for a site file, injecting the top bar for HTML on free plans.
 *
 * @param object      - R2 object body.
 * @param site        - Site metadata (slug, plan).
 * @param contentType - MIME type for the Content-Type header.
 * @returns Fully formed Response.
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
  if (contentType.startsWith('text/html') && site.plan !== 'paid') {
    const html = await object.text();
    const topBar = generateTopBar(site.slug);

    // Inject after <body> tag
    const injected = html.replace(/(<body[^>]*>)/i, `$1\n${topBar}\n`);

    return new Response(injected, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}

/**
 * Map a file extension to its MIME type.
 *
 * @param path - File path or URL pathname.
 * @returns MIME type string (defaults to `application/octet-stream`).
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
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
