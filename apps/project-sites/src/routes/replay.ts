/**
 * @module routes/replay
 * @description Build-replay scrubber at `/showcase/:slug/replay` (1337 LAYER #3).
 *
 * Reads `iteration_snapshots` for a site, renders a horizontal scrubber timeline
 * with thumbnails, lighthouse sparkline, delight-count badge, and autoplay
 * fade-through. Pulls R2 screenshots via the bucket binding so we don't ship
 * direct R2 URLs (keeps the bucket private).
 *
 * Contract (skill 15 build-breaking-rules.md, 1337 LAYER #3):
 * - Public read endpoint (no auth required — historical state is part of the
 *   site's marketing story).
 * - Sites with <2 iterations get a graceful "first build still warm" stub.
 * - Lazy-loads images via `data-src` to keep first paint <40KB.
 * - Plays at 1.2s per frame; <space> pause; arrow keys scrub.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbQuery } from '../services/db.js';

const replay = new Hono<{ Bindings: Env; Variables: Variables }>();

interface SiteRow {
  id: string;
  slug: string;
  business_name: string;
  iteration_count: number | null;
}

interface SnapshotRow {
  iteration: number;
  taken_at: string;
  screenshot_r2_key: string;
  thumb_r2_key: string | null;
  lighthouse_perf: number | null;
  lighthouse_a11y: number | null;
  lighthouse_seo: number | null;
  lighthouse_best_practices: number | null;
  delight_count: number;
  applied_goodies_json: string | null;
  diff_art_og_r2_key: string | null;
}

replay.get('/showcase/:slug/replay', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.notFound();

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, business_name, iteration_count FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.notFound();

  const snapshots = await dbQuery<SnapshotRow>(
    c.env.DB,
    `SELECT iteration, taken_at, screenshot_r2_key, thumb_r2_key,
            lighthouse_perf, lighthouse_a11y, lighthouse_seo, lighthouse_best_practices,
            delight_count, applied_goodies_json, diff_art_og_r2_key
     FROM iteration_snapshots
     WHERE site_id = ?
     ORDER BY iteration ASC`,
    [site.id],
  );

  const html = renderReplayHtml(site, snapshots.data);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
});

replay.get('/showcase/:slug/replay/asset/:iteration/:kind', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  const kind = c.req.param('kind');
  if (!slug || !Number.isFinite(iteration) || !kind) return c.notFound();

  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.notFound();

  const snap = await dbQueryOne<{
    screenshot_r2_key: string;
    thumb_r2_key: string | null;
    diff_art_og_r2_key: string | null;
  }>(
    c.env.DB,
    'SELECT screenshot_r2_key, thumb_r2_key, diff_art_og_r2_key FROM iteration_snapshots WHERE site_id = ? AND iteration = ?',
    [site.id, iteration],
  );
  if (!snap) return c.notFound();

  let key: string | null = null;
  if (kind === 'screenshot') key = snap.screenshot_r2_key;
  else if (kind === 'thumb') key = snap.thumb_r2_key ?? snap.screenshot_r2_key;
  else if (kind === 'art') key = snap.diff_art_og_r2_key;
  if (!key) return c.notFound();

  const obj = await c.env.SITES_BUCKET.get(key);
  if (!obj) return c.notFound();

  const ext = key.split('.').pop()?.toLowerCase() ?? 'png';
  const mime =
    ext === 'svg' ? 'image/svg+xml'
    : ext === 'webp' ? 'image/webp'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : 'image/png';

  return new Response(obj.body, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

function renderReplayHtml(site: SiteRow, snapshots: SnapshotRow[]): string {
  const totalIterations = snapshots.length;
  const heading = escapeHtml(site.business_name || site.slug);

  if (totalIterations === 0) {
    return [
      `<!doctype html><html lang="en"><head><meta charset="utf-8" />`,
      `<title>Replay — ${heading}</title>`,
      `<meta name="robots" content="noindex,nofollow" />`,
      `<style>${baseStyles()}</style></head><body class="empty">`,
      `<main><h1>First build still warm.</h1>`,
      `<p>This site has not been re-built yet. Replay unlocks at iteration 2.</p>`,
      `<a class="cta" href="/${escapeHtml(site.slug)}">Visit the site</a></main></body></html>`,
    ].join('');
  }

  const sparkline = renderSparkline(snapshots);
  const frames = snapshots
    .map((s, idx) => {
      const lighthouse = [
        s.lighthouse_perf,
        s.lighthouse_a11y,
        s.lighthouse_seo,
        s.lighthouse_best_practices,
      ]
        .map((v) => (v == null ? '—' : String(v)))
        .join(' · ');
      const goodies = parseGoodies(s.applied_goodies_json);
      const screenshotUrl = `/showcase/${encodeURIComponent(site.slug)}/replay/asset/${s.iteration}/screenshot`;
      const thumbUrl = `/showcase/${encodeURIComponent(site.slug)}/replay/asset/${s.iteration}/thumb`;
      return [
        `<figure class="frame" data-idx="${idx}" data-src="${screenshotUrl}">`,
        `<img class="shot" alt="Iteration ${s.iteration}" loading="${idx === 0 ? 'eager' : 'lazy'}" `,
        `src="${idx === 0 ? screenshotUrl : ''}" data-src="${screenshotUrl}" data-thumb="${thumbUrl}" />`,
        `<figcaption>`,
        `<span class="iter">iter ${s.iteration}</span>`,
        `<span class="lh">LH ${lighthouse}</span>`,
        `<span class="delight">✦ ${s.delight_count}</span>`,
        goodies.length ? `<span class="goodies">${goodies.map(escapeHtml).join(' · ')}</span>` : '',
        `</figcaption></figure>`,
      ].join('');
    })
    .join('');

  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width,initial-scale=1" />`,
    `<meta name="robots" content="noindex,nofollow" />`,
    `<title>Replay — ${heading}</title>`,
    `<meta property="og:title" content="${heading} — build replay" />`,
    `<meta property="og:description" content="${totalIterations} builds. Watch the polish accrue." />`,
    `<style>${baseStyles()}</style></head><body>`,
    `<header><h1>${heading}</h1><p class="sub">${totalIterations} iterations · scrub to replay</p></header>`,
    `<section class="spark">${sparkline}</section>`,
    `<section class="scrubber">`,
    `<div class="rail">${frames}</div>`,
    `<div class="controls">`,
    `<button id="play" type="button">▶ Play</button>`,
    `<input id="seek" type="range" min="0" max="${totalIterations - 1}" value="0" aria-label="Scrub iteration" />`,
    `<output id="readout">iter 1 / ${totalIterations}</output>`,
    `</div></section>`,
    `<script>${scrubberScript(totalIterations)}</script>`,
    `</body></html>`,
  ].join('');
}

function renderSparkline(snapshots: SnapshotRow[]): string {
  const perf = snapshots.map((s) => s.lighthouse_perf ?? 0);
  if (perf.length === 0) return '';
  const w = 800;
  const h = 80;
  const max = Math.max(100, ...perf);
  const pts = perf
    .map((v, i) => {
      const x = (i / Math.max(perf.length - 1, 1)) * w;
      const y = h - (v / max) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Lighthouse performance over time"><polyline fill="none" stroke="#64ffda" stroke-width="2" points="${pts}" /></svg>`;
}

function parseGoodies(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string').slice(0, 4);
  } catch {
    /* ignore */
  }
  return [];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseStyles(): string {
  return `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060a;color:#e6f3ff;font-family:'Inter','Space Grotesk',system-ui,sans-serif;min-height:100vh}
body.empty{display:grid;place-items:center;text-align:center;padding:4rem}
header{padding:2.5rem 2rem 1rem;border-bottom:1px solid rgba(100,255,218,.1)}
header h1{font-size:clamp(1.6rem,4vw,2.4rem);background:linear-gradient(135deg,#64ffda,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#7d8aa5;margin-top:.35rem}
.spark{padding:1rem 2rem;border-bottom:1px solid rgba(100,255,218,.05)}
.spark svg{width:100%;height:60px;display:block}
.scrubber{padding:2rem;display:grid;gap:1rem}
.rail{display:flex;gap:.75rem;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:.5rem;-webkit-overflow-scrolling:touch}
.frame{flex:0 0 auto;width:min(72vw,520px);scroll-snap-align:center;background:#0c0c14;border:1px solid rgba(100,255,218,.08);border-radius:14px;overflow:hidden;transition:transform .2s ease,border-color .2s ease}
.frame.active{border-color:#64ffda;transform:translateY(-2px);box-shadow:0 18px 60px -32px rgba(100,255,218,.7)}
.frame img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#0a0a12}
figcaption{display:flex;flex-wrap:wrap;gap:.5rem;padding:.65rem .85rem;font-size:12px;color:#a8b3cc}
figcaption .iter{color:#64ffda;font-weight:600}
figcaption .delight{color:#f5d76e}
figcaption .lh{font-family:'JetBrains Mono',monospace;font-size:11px;color:#7d8aa5}
figcaption .goodies{flex-basis:100%;color:#cfd6e6;font-family:'JetBrains Mono',monospace;font-size:11px}
.controls{display:flex;gap:1rem;align-items:center;padding-top:.5rem;border-top:1px solid rgba(255,255,255,.04)}
button{background:linear-gradient(135deg,#64ffda,#7c3aed);color:#06060a;border:0;border-radius:999px;padding:.55rem 1.2rem;font-weight:700;cursor:pointer;font-size:13px}
input[type="range"]{flex:1;accent-color:#64ffda}
output{font-family:'JetBrains Mono',monospace;color:#a8b3cc;font-size:12px;min-width:9ch;text-align:right}
.cta{display:inline-block;margin-top:1.5rem;padding:.8rem 1.6rem;border-radius:999px;background:#64ffda;color:#06060a;font-weight:700;text-decoration:none}
@media (prefers-reduced-motion: reduce){.frame{transition:none}.frame.active{transform:none}}
`;
}

function scrubberScript(count: number): string {
  return `(() => {
  const frames = Array.from(document.querySelectorAll('.frame'));
  const seek = document.getElementById('seek');
  const playBtn = document.getElementById('play');
  const readout = document.getElementById('readout');
  let active = 0;
  let timer = null;
  const total = ${count};

  function activate(idx) {
    active = (idx + total) % total;
    frames.forEach((f, i) => f.classList.toggle('active', i === active));
    const target = frames[active];
    const img = target.querySelector('img');
    if (img && !img.src) img.src = img.dataset.src;
    target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    seek.value = String(active);
    readout.value = 'iter ' + (active + 1) + ' / ' + total;
  }

  function play() {
    if (timer) return;
    playBtn.textContent = '⏸ Pause';
    timer = setInterval(() => activate(active + 1), 1200);
  }
  function pause() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playBtn.textContent = '▶ Play';
  }

  playBtn.addEventListener('click', () => (timer ? pause() : play()));
  seek.addEventListener('input', (e) => { pause(); activate(Number(e.target.value)); });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); timer ? pause() : play(); }
    if (e.key === 'ArrowRight') activate(active + 1);
    if (e.key === 'ArrowLeft') activate(active - 1);
  });

  activate(0);
})();`;
}

export { replay };
