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
 *   ├─ Subdomain (slug.projectsites.dev) → lookup by slug
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

import { DOMAINS } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';

/**
 * Generate the promotional top bar HTML injected into unpaid sites.
 *
 * The bar is fixed to the top of the viewport and includes a CTA to upgrade.
 * It cannot be dismissed — the visitor must upgrade to remove it.
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
  return generateConversionFlow(slug);
}

/**
 * Generate the "Wow → Own → Buy" conversion flow for unpaid sites.
 *
 * Two components injected:
 * 1. Bottom bar with badge + CTA (appears after 25s or 40% scroll, animated)
 * 2. Ownership modal (on "Claim" click — plan, domain search, Stripe checkout)
 *
 * Zero external dependencies. Self-contained vanilla JS/CSS.
 */
export function generateConversionFlow(slug: string): string {
  const editUrl = `https://${DOMAINS.BOLT_BASE}/?slug=${encodeURIComponent(slug)}`;

  return `<!-- ProjectSites Conversion Flow v2 -->
<style>
@keyframes ps-slide-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes ps-fade-in{from{opacity:0}to{opacity:1}}
@keyframes ps-modal-in{from{opacity:0;transform:translateY(24px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes ps-pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,0.4)}50%{box-shadow:0 0 0 6px rgba(124,58,237,0)}}
@keyframes ps-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
#ps-bar{position:fixed;bottom:0;left:0;right:0;z-index:99998;transform:translateY(100%);opacity:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#ps-bar.ps-visible{animation:ps-slide-up 0.6s cubic-bezier(0.16,1,0.3,1) forwards}
#ps-bar-inner{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:linear-gradient(135deg,rgba(10,6,30,0.97) 0%,rgba(22,14,56,0.97) 100%);backdrop-filter:blur(20px);border-top:1px solid rgba(124,58,237,0.15);box-shadow:0 -8px 32px rgba(0,0,0,0.4)}
#ps-bar-left{display:flex;align-items:center;gap:12px}
#ps-bar-brand{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(255,255,255,0.5);transition:all 0.25s;text-decoration:none}
#ps-bar-brand:hover{background:rgba(255,255,255,0.08);border-color:rgba(124,58,237,0.3);color:rgba(255,255,255,0.8)}
#ps-bar-brand svg{opacity:0.5}
#ps-bar-edit{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;background:rgba(100,255,218,0.06);border:1px solid rgba(100,255,218,0.15);color:#64ffda;font-size:11px;font-weight:600;text-decoration:none;letter-spacing:0.02em;transition:all 0.25s}
#ps-bar-edit:hover{background:rgba(100,255,218,0.12);border-color:rgba(100,255,218,0.35);transform:translateY(-1px)}
#ps-bar-edit:active{transform:translateY(0)}
#ps-bar-msg{color:rgba(255,255,255,0.7);font-size:13px;margin:0}
#ps-bar-msg strong{color:#fff}
#ps-bar-right{display:flex;align-items:center;gap:10px}
#ps-claim-btn{padding:8px 22px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:0 2px 12px rgba(124,58,237,0.3);letter-spacing:0.01em;animation:ps-pulse 2.5s infinite}
#ps-claim-btn:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 6px 24px rgba(124,58,237,0.5)}
#ps-claim-btn:active{transform:translateY(0) scale(0.98)}
#ps-bar-x{background:none;border:none;color:rgba(255,255,255,0.25);font-size:16px;cursor:pointer;padding:4px;transition:all 0.2s;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center}
#ps-bar-x:hover{color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.05)}
#ps-overlay{display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0);backdrop-filter:blur(0px);transition:all 0.3s ease;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#ps-overlay.ps-open{display:flex;background:rgba(0,0,0,0.65);backdrop-filter:blur(10px)}
#ps-modal{background:linear-gradient(160deg,#0c0824 0%,#12093a 40%,#0c0824 100%);border:1px solid rgba(124,58,237,0.2);border-radius:20px;max-width:480px;width:calc(100% - 32px);max-height:calc(100vh - 48px);overflow-y:auto;padding:28px;color:#fff;box-shadow:0 32px 80px rgba(0,0,0,0.7),0 0 60px rgba(124,58,237,0.08);animation:ps-modal-in 0.35s cubic-bezier(0.16,1,0.3,1)}
#ps-modal h2{font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-0.01em}
#ps-modal .ps-sub{color:rgba(255,255,255,0.4);font-size:12px;margin:0 0 20px;font-family:monospace}
.ps-plan{background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.18);border-radius:14px;padding:18px;margin-bottom:16px}
.ps-price-row{display:flex;align-items:baseline;gap:6px;margin-bottom:14px}
.ps-price{font-size:36px;font-weight:800;background:linear-gradient(135deg,#fff,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.ps-period{font-size:13px;color:rgba(255,255,255,0.4)}
.ps-features{list-style:none;padding:0;margin:0 0 16px;display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ps-features li{font-size:12px;color:rgba(255,255,255,0.65);display:flex;align-items:center;gap:5px}
.ps-check{width:14px;height:14px;flex-shrink:0;color:#4ade80}
.ps-domain-section{margin-top:14px;position:relative}
.ps-domain-label{display:block;font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em}
.ps-domain-wrap{position:relative}
.ps-domain-input{width:100%;padding:10px 40px 10px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(124,58,237,0.25);border-radius:10px;color:#fff;font-size:14px;font-family:inherit;outline:none;transition:all 0.25s;box-sizing:border-box}
.ps-domain-input:focus{border-color:rgba(124,58,237,0.6);box-shadow:0 0 20px rgba(124,58,237,0.15);background:rgba(255,255,255,0.08)}
.ps-domain-input::placeholder{color:rgba(255,255,255,0.25)}
.ps-domain-input.ps-available{border-color:rgba(74,222,128,0.5);box-shadow:0 0 16px rgba(74,222,128,0.1)}
.ps-domain-input.ps-unavailable{border-color:rgba(239,68,68,0.4);box-shadow:0 0 12px rgba(239,68,68,0.08)}
.ps-domain-status{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:16px;transition:all 0.2s;opacity:0}
.ps-domain-status.ps-show{opacity:1}
.ps-results{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px;min-height:24px}
.ps-tag{padding:3px 10px;border-radius:7px;font-size:11px;font-weight:500;transition:all 0.2s;border:1px solid transparent;cursor:default}
.ps-tag-avail{background:rgba(74,222,128,0.08);color:#4ade80;border-color:rgba(74,222,128,0.15);cursor:pointer}
.ps-tag-avail:hover{background:rgba(74,222,128,0.16);border-color:rgba(74,222,128,0.35);transform:translateY(-1px)}
.ps-tag-avail.ps-sel{background:rgba(74,222,128,0.2);border-color:#4ade80;box-shadow:0 0 8px rgba(74,222,128,0.15)}
.ps-tag-taken{background:rgba(255,255,255,0.02);color:rgba(255,255,255,0.2);text-decoration:line-through}
.ps-tag-checking{color:rgba(255,255,255,0.3);font-size:11px;background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:ps-shimmer 1.5s infinite;border-radius:7px;padding:3px 10px}
#ps-go-btn{width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:0 4px 16px rgba(124,58,237,0.3);margin-top:14px}
#ps-go-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 28px rgba(124,58,237,0.45)}
#ps-go-btn:active:not(:disabled){transform:translateY(0)}
#ps-go-btn:disabled{opacity:0.5;cursor:not-allowed}
.ps-footer{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px}
.ps-footer a,.ps-footer button{background:none;border:none;color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer;text-decoration:none;transition:color 0.2s;font-family:inherit;padding:0}
.ps-footer a:hover,.ps-footer button:hover{color:rgba(255,255,255,0.8)}
#ps-close-modal{position:absolute;top:10px;right:14px;background:none;border:none;color:rgba(255,255,255,0.2);font-size:20px;cursor:pointer;transition:all 0.2s;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%}
#ps-close-modal:hover{color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.05)}
@media(max-width:600px){#ps-bar-inner{flex-wrap:wrap;gap:8px;padding:8px 14px}#ps-bar-msg{width:100%;text-align:center;font-size:12px}#ps-bar-left{width:100%;justify-content:center}#ps-bar-right{width:100%;justify-content:center}#ps-modal{padding:20px 16px}.ps-features{grid-template-columns:1fr}}
</style>

<!-- Bottom Bar (badge + CTA integrated, hidden initially) -->
<div id="ps-bar">
  <div id="ps-bar-inner">
    <div id="ps-bar-left">
      <a id="ps-bar-brand" href="https://${DOMAINS.SITES_BASE}" target="_blank" rel="noopener" title="Built by ProjectSites">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="psg" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#6d28d9"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#psg)"/><path d="M8 12l8-4 8 4M8 16l8 4 8-4M8 20l8 4 8-4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><circle cx="16" cy="12" r="2" fill="#fff" opacity="0.7"/></svg>
      </a>
      <a id="ps-bar-edit" href="${editUrl}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
        Edit with AI
      </a>
    </div>
    <p id="ps-bar-msg"><strong>This website is yours</strong> — make it official</p>
    <div id="ps-bar-right">
      <button id="ps-claim-btn">Claim for $50/mo</button>
      <button id="ps-bar-x" aria-label="Dismiss">&times;</button>
    </div>
  </div>
</div>

<!-- Ownership Modal -->
<div id="ps-overlay">
  <div id="ps-modal" style="position:relative">
    <button id="ps-close-modal" aria-label="Close">&times;</button>
    <h2>Make It Yours</h2>
    <p class="ps-sub">${slug}.projectsites.dev</p>

    <div class="ps-plan">
      <div class="ps-price-row">
        <span class="ps-price">$50</span>
        <span class="ps-period">/ month</span>
      </div>
      <ul class="ps-features">
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Custom domain</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Edit with AI</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>No branding</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>SSL &amp; CDN</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Contact form</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Analytics</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Google Maps</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Priority support</li>
      </ul>

      <div class="ps-domain-section">
        <label class="ps-domain-label">Choose your domain</label>
        <div class="ps-domain-wrap">
          <input class="ps-domain-input" id="ps-dinput" type="text" placeholder="yourbusiness.com" autocomplete="off" spellcheck="false" />
          <span class="ps-domain-status" id="ps-dstatus"></span>
        </div>
        <div class="ps-results" id="ps-dresults"></div>
      </div>

      <button id="ps-go-btn">Get Started — $50/month</button>
    </div>

    <div class="ps-footer">
      <a href="${editUrl}">✏️ Edit with AI first</a>
      <span style="color:rgba(255,255,255,0.1)">·</span>
      <button onclick="document.getElementById('ps-overlay').classList.remove('ps-open')">Keep free for now</button>
    </div>
  </div>
</div>

<script>
(function(){
  if(window!==window.top)return;
  /* Enforce smooth scroll on all anchor links site-wide */
  document.documentElement.style.scrollBehavior='smooth';
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href^="#"]');
    if(a){var t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'})}}
  });
  var S='${slug}',API='https://${DOMAINS.SITES_BASE}';
  var bar=document.getElementById('ps-bar');
  var overlay=document.getElementById('ps-overlay');
  var dinput=document.getElementById('ps-dinput');
  var dstatus=document.getElementById('ps-dstatus');
  var dresults=document.getElementById('ps-dresults');
  var goBtn=document.getElementById('ps-go-btn');
  var sel='';
  var dt;

  /* Show bar after 25s or 40% scroll */
  if(!sessionStorage.getItem('ps-x')){
    var s=false;
    function show(){if(!s){s=true;bar.classList.add('ps-visible')}}
    setTimeout(show,25000);
    window.addEventListener('scroll',function(){
      var pct=window.scrollY/(document.documentElement.scrollHeight-window.innerHeight);
      if(pct>0.4)show();
    },{passive:true});
  }

  /* Open/close modal */
  document.getElementById('ps-claim-btn').onclick=function(){overlay.classList.add('ps-open')};
  document.getElementById('ps-close-modal').onclick=function(){overlay.classList.remove('ps-open')};
  overlay.onclick=function(e){if(e.target===overlay)overlay.classList.remove('ps-open')};
  document.getElementById('ps-bar-x').onclick=function(){bar.style.display='none';sessionStorage.setItem('ps-x','1')};

  /* Domain search — checks exact + variations */
  dinput.addEventListener('input',function(){
    clearTimeout(dt);
    var v=this.value.trim().replace(/[^a-z0-9.-]/gi,'').toLowerCase().replace(/\\.[a-z]+$/i,'');
    if(v.length<2){dresults.innerHTML='';dstatus.className='ps-domain-status';dstatus.textContent='';sel='';return}
    dstatus.className='ps-domain-status ps-show';dstatus.textContent='⏳';
    dresults.innerHTML='<span class="ps-tag-checking">Checking availability...</span>';
    dt=setTimeout(function(){
      fetch(API+'/api/domains/availability?name='+encodeURIComponent(v))
        .then(function(r){return r.json()})
        .then(function(d){
          var items=d.data||[];
          var anyAvail=items.some(function(i){return i.available});
          /* Update input status indicator */
          var exact=items.find(function(i){return i.domain===v+'.com'});
          if(exact){
            if(exact.available){dstatus.textContent='✅';dstatus.className='ps-domain-status ps-show';dinput.className='ps-domain-input ps-available'}
            else{dstatus.textContent='❌';dstatus.className='ps-domain-status ps-show';dinput.className='ps-domain-input ps-unavailable'}
          }else{dstatus.className='ps-domain-status';dinput.className='ps-domain-input'}
          /* Render tags */
          dresults.innerHTML='';sel='';
          items.forEach(function(it){
            var t=document.createElement('span');
            t.className='ps-tag '+(it.available?'ps-tag-avail':'ps-tag-taken');
            t.textContent=it.domain;
            if(it.available){
              if(!sel){sel=it.domain;t.classList.add('ps-sel')}
              t.onclick=function(){
                document.querySelectorAll('.ps-tag.ps-sel').forEach(function(x){x.classList.remove('ps-sel')});
                t.classList.add('ps-sel');sel=it.domain;
              };
            }
            dresults.appendChild(t);
          });
          if(!anyAvail&&items.length>0){
            var hint=document.createElement('span');
            hint.style.cssText='display:block;width:100%;font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px';
            hint.textContent='Try adding a prefix like "get" or "my", or a different name';
            dresults.appendChild(hint);
          }
        })
        .catch(function(){
          dstatus.textContent='⚠️';dstatus.className='ps-domain-status ps-show';
          dresults.innerHTML='<span style="font-size:11px;color:rgba(255,255,255,0.3)">Domain search temporarily unavailable — you can add a domain later</span>';
        });
    },500);
  });

  /* Checkout */
  goBtn.onclick=function(){
    goBtn.disabled=true;goBtn.textContent='Redirecting to checkout...';
    fetch(API+'/api/conversion/checkout',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slug:S,domain:sel||null})
    })
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.data&&d.data.checkout_url)window.location.href=d.data.checkout_url;
      else{goBtn.textContent='Error — try again';goBtn.disabled=false}
    })
    .catch(function(){goBtn.textContent='Connection error — try again';goBtn.disabled=false});
  };
})();
</script>
<!-- End ProjectSites Conversion Flow -->`;
}

/**
 * Resolve a hostname to a site record.
 *
 * Uses a two-tier lookup: KV cache (60 s TTL) → D1 database.
 * Supports dot-based subdomains (`slug.projectsites.dev`), legacy dash-based
 * subdomains (`slug-sites.megabyte.space`), and custom CNAME domains
 * (looked up in the `hostnames` table).
 *
 * @param env      - Worker environment (needs `CACHE_KV`, `DB`).
 * @param db       - D1Database binding.
 * @param hostname - The incoming request's `Host` header value.
 * @returns Resolved site info or `null` if not found.
 *
 * @example
 * ```ts
 * const site = await resolveSite(env, env.DB, 'vitos-mens-salon.projectsites.dev');
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

  // Extract slug from hostname (e.g., slug.projectsites.dev)
  let slug: string | null = null;
  const RESERVED_SLUGS = new Set(['editor', 'www', 'api', 'admin', 'staging', 'mail', 'smtp']);

  if (hostname.endsWith(DOMAINS.SITES_SUFFIX)) {
    slug = hostname.slice(0, -DOMAINS.SITES_SUFFIX.length);
  }

  // Don't resolve reserved subdomains as sites
  if (slug && RESERVED_SLUGS.has(slug)) {
    slug = null;
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

  // Look up by slug — with snapshot resolution
  // Pattern: {slug}-{snapshot}.projectsites.dev → serve frozen version
  // The snapshot name is separated by the LAST occurrence of a known snapshot pattern
  if (slug) {
    // First try exact slug match
    let siteRow = await dbQueryOne<{
      id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
    }>(
      db,
      'SELECT id, slug, org_id, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug],
    );

    // If no exact match, try snapshot resolution: {slug}-{snapshot}
    let snapshotVersion: string | null = null;
    if (!siteRow && slug.includes('-')) {
      // Try progressively shorter prefixes to find the base slug
      const parts = slug.split('-');
      for (let i = parts.length - 1; i >= 1; i--) {
        const candidateSlug = parts.slice(0, i).join('-');
        const candidateSnapshot = parts.slice(i).join('-');
        const candidateRow = await dbQueryOne<{
          id: string;
          slug: string;
          org_id: string;
          current_build_version: string | null;
        }>(
          db,
          'SELECT id, slug, org_id, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
          [candidateSlug],
        );
        if (candidateRow) {
          // Found a base site — now look up the snapshot
          const snapshot = await dbQueryOne<{ build_version: string }>(
            db,
            'SELECT build_version FROM site_snapshots WHERE site_id = ? AND snapshot_name = ? AND deleted_at IS NULL',
            [candidateRow.id, candidateSnapshot],
          );
          if (snapshot) {
            siteRow = candidateRow;
            snapshotVersion = snapshot.build_version;
            console.warn(JSON.stringify({
              level: 'debug', service: 'site_serving',
              message: 'Snapshot resolved', slug: candidateSlug, snapshot: candidateSnapshot,
              version: snapshot.build_version,
            }));
          }
          break;
        }
      }
    }

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
        // Use snapshot version if resolved, otherwise latest
        current_build_version: snapshotVersion || siteRow.current_build_version,
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

  // If the site has no published version yet (still building), show a branded "building" page
  if (!site.current_build_version) {
    const buildingHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Building... | ${site.slug}</title><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;overflow:hidden}@keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.8}}@keyframes spin{to{transform:rotate(360deg)}}.bg{position:fixed;inset:0;background:linear-gradient(-45deg,#0a0a0f,#0d1117,#0a1628,#0f0a1e);background-size:400% 400%;animation:gradient 8s ease infinite}.container{text-align:center;max-width:500px;padding:2rem;position:relative;z-index:1}.spinner{width:60px;height:60px;border:3px solid rgba(0,255,200,.1);border-top-color:#00ffc8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 2rem}.title{font-size:2rem;font-weight:700;background:linear-gradient(135deg,#00ffc8,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:pulse 2s ease-in-out infinite}.subtitle{color:#8892a4;margin-top:1rem;font-size:1.1rem;line-height:1.6}.slug{color:#4a9;font-family:monospace;font-size:.9rem;margin-top:1.5rem}p.note{color:#556;font-size:.8rem;margin-top:2rem}</style><meta http-equiv="refresh" content="15"></head><body><div class="bg"></div><div class="container"><div class="spinner"></div><div class="title">Building your website</div><p class="subtitle">Our AI is crafting a gorgeous, custom website. This usually takes a few minutes.</p><p class="slug">${site.slug}.projectsites.dev</p><p class="note">This page auto-refreshes every 15 seconds.</p></div></body></html>`;
    return new Response(buildingHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache, no-store' },
    });
  }

  const version = site.current_build_version;

  // Normalize path: resolve directory-style URLs to index.html
  let filePath = requestPath;
  if (filePath === '/') {
    filePath = '/index.html';
  } else if (filePath.endsWith('/')) {
    // /about/ → /about/index.html
    filePath += 'index.html';
  }

  const r2Path = `sites/${site.slug}/${version}${filePath}`;

  console.warn(JSON.stringify({ level: 'info', action: 'serve_site_lookup', slug: site.slug, version, r2Path }));

  let object = await env.SITES_BUCKET.get(r2Path);

  // For paths without extensions (e.g. /about), try directory index then .html extension
  if (!object && !filePath.includes('.')) {
    // /about → try /about/index.html
    const dirIndexPath = `sites/${site.slug}/${version}${filePath}/index.html`;
    object = await env.SITES_BUCKET.get(dirIndexPath);

    if (!object) {
      // /about → try /about.html
      const htmlPath = `sites/${site.slug}/${version}${filePath}.html`;
      object = await env.SITES_BUCKET.get(htmlPath);
    }
  }

  // For paths with nested directories that didn't match, try flat file name fallback
  // e.g. /blog/barbara-cary → try /blog-barbara-cary.html
  if (!object && filePath.includes('/') && !filePath.includes('.')) {
    const flatName = filePath.replace(/^\//, '').replace(/\//g, '-');
    const flatPath = `sites/${site.slug}/${version}/${flatName}.html`;
    object = await env.SITES_BUCKET.get(flatPath);
    if (object) {
      console.warn(JSON.stringify({ level: 'info', action: 'serve_flat_fallback', slug: site.slug, flatPath }));
    }
  }

  if (!object) {
    // Try assets/ directory (logo, favicon, discovered images — not versioned)
    if (requestPath.startsWith('/assets/')) {
      const assetPath = `sites/${site.slug}${requestPath}`;
      const asset = await env.SITES_BUCKET.get(assetPath);
      if (asset) {
        const ext = requestPath.split('.').pop()?.toLowerCase() || '';
        const ct = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon' }[ext] || 'application/octet-stream';
        return new Response(asset.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
      }
    }

    // Try index.html for SPA fallback (catch-all for client-side routing)
    if (!requestPath.includes('.')) {
      const fallbackPath = `sites/${site.slug}/${version}/index.html`;
      const fallback = await env.SITES_BUCKET.get(fallbackPath);

      if (fallback) {
        console.warn(JSON.stringify({ level: 'info', action: 'serve_spa_fallback', slug: site.slug, requestPath }));

        return buildSiteResponse(fallback, site, 'text/html; charset=utf-8', env);
      }
    }

    console.warn(JSON.stringify({ level: 'warn', action: 'serve_not_found', slug: site.slug, r2Path, requestPath }));

    return new Response('Not Found', { status: 404 });
  }

  // Use the resolved file path for content-type detection, not the raw request path.
  // Raw path '/' has no extension → would return 'application/octet-stream' (download).
  // For directory/bare paths that resolved via fallback, force text/html.
  const contentType = filePath.includes('.') ? getContentType(filePath) : 'text/html; charset=utf-8';
  return buildSiteResponse(object, site, contentType, env);
}

/**
 * Generate Google Tag Manager container snippet (head portion).
 *
 * @param containerId - GTM Container ID (e.g., GTM-XXXXXXX).
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generateGtmHeadSnippet(containerId: string): string {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');</script>`;
}

/**
 * Generate Google Tag Manager noscript snippet (body portion).
 *
 * @param containerId - GTM Container ID (e.g., GTM-XXXXXXX).
 * @returns HTML `<noscript>` block to inject after `<body>`.
 */
function generateGtmBodySnippet(containerId: string): string {
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * Generate Google Analytics 4 (gtag.js) tracking snippet.
 *
 * Injects the GA4 global site tag with site_slug as a custom dimension
 * for per-site segmentation across a single GA4 property.
 *
 * @param measurementId - GA4 Measurement ID (e.g., G-XXXXXXXX).
 * @param slug          - Site slug for custom dimension enrichment.
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generateGa4Snippet(measurementId: string, slug: string): string {
  return `<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${measurementId}',{
  send_page_view:true,
  custom_map:{'dimension1':'site_slug'},
  site_slug:'${slug}'
});
</script>`;
}

/**
 * Generate the PostHog client-side tracking snippet.
 *
 * Injects the PostHog JS SDK loader and initializes it with the project API key.
 * Uses `identified_only` person profiles to minimize data collection.
 *
 * @param posthogApiKey - PostHog project API key.
 * @param slug          - Site slug for event enrichment.
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generatePostHogSnippet(posthogApiKey: string, slug: string): string {
  return `<!-- PostHog Analytics -->
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${posthogApiKey}',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'});
posthog.capture('$pageview',{site_slug:'${slug}'});
</script>`;
}

/**
 * Generate the Sentry client-side error tracking snippet.
 *
 * Uses the lightweight Sentry Loader approach for minimal bundle impact.
 * The DSN is extracted to build the loader URL.
 *
 * @param sentryDsn - Full Sentry DSN string.
 * @param slug      - Site slug for Sentry tag enrichment.
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generateSentrySnippet(sentryDsn: string, slug: string): string {
  // Extract the public key from the DSN for the loader URL
  // DSN format: https://{public_key}@{host}/{project_id}
  const dsnMatch = sentryDsn.match(/https:\/\/([^@]+)@[^/]+\/(\d+)/);
  if (!dsnMatch) return '';

  const projectId = dsnMatch[2];
  return `<!-- Sentry Error Tracking -->
<script
  src="https://js.sentry-cdn.com/${dsnMatch[1]}.min.js"
  crossorigin="anonymous"
></script>
<script>
window.Sentry && Sentry.onLoad(function(){
  Sentry.init({dsn:'${sentryDsn}',tracesSampleRate:0.1,environment:'production'});
  Sentry.setTag('site_slug','${slug}');
  Sentry.setTag('project_id','${projectId}');
});
</script>`;
}

/**
 * Build an HTTP response for a site file, injecting analytics, error tracking,
 * and the promotional top bar for HTML on free plans.
 *
 * @param object      - R2 object body.
 * @param site        - Site metadata (slug, plan).
 * @param contentType - MIME type for the Content-Type header.
 * @param env         - Worker environment for PostHog/Sentry keys.
 * @returns Fully formed Response.
 */
async function buildSiteResponse(
  object: R2ObjectBody,
  site: { slug: string; plan: string },
  contentType: string,
  env?: Env,
): Promise<Response> {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Site-Slug': site.slug,
  });

  // For HTML responses, inject tracking snippets and top bar
  if (contentType.startsWith('text/html')) {
    let html = await object.text();

    // Inject analytics + error tracking before </head> (for all sites, paid and free)
    if (env) {
      let headInjection = '';

      // Google Tag Manager (head script)
      if (env.GTM_CONTAINER_ID) {
        headInjection += generateGtmHeadSnippet(env.GTM_CONTAINER_ID);
      }

      // Google Analytics 4
      if (env.GA4_MEASUREMENT_ID) {
        headInjection += generateGa4Snippet(env.GA4_MEASUREMENT_ID, site.slug);
      }

      if (env.POSTHOG_API_KEY) {
        headInjection += generatePostHogSnippet(env.POSTHOG_API_KEY, site.slug);
      }

      if (env.SENTRY_DSN) {
        headInjection += generateSentrySnippet(env.SENTRY_DSN, site.slug);
      }

      if (headInjection) {
        html = html.replace(/<\/head>/i, `${headInjection}\n</head>`);
      }
    }

    // Inject GTM noscript + top bar after <body>
    let bodyInjection = '';
    if (env?.GTM_CONTAINER_ID) {
      bodyInjection += generateGtmBodySnippet(env.GTM_CONTAINER_ID);
    }
    if (site.plan !== 'paid') {
      bodyInjection += generateTopBar(site.slug);
    }
    if (bodyInjection) {
      html = html.replace(/(<body[^>]*>)/i, `$1\n${bodyInjection}\n`);
    }

    return new Response(html, { status: 200, headers });
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
