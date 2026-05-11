/**
 * @module routes/diff_art
 * @description Diff-as-art generative artwork (1337 LAYER #5).
 *
 * Turns a build diff (files_changed / additions / deletions / churn_score)
 * into a deterministic, brand-colored SVG composition rendered at three
 * canonical aspect ratios: 1080×1920 (phone story), 2400×1260 (desktop OG),
 * 1200×630 (standard OG). Same seed → same image. R2-cached forever.
 *
 * Contract (skill 15 build-breaking-rules.md, 1337 LAYER #5):
 * - Deterministic: hash of (site_id, iteration, files_changed, additions,
 *   deletions, churn_score, brand_primary) drives every random choice.
 * - Three R2 keys per iteration: art-phone.svg | art-desktop.svg | art-og.svg
 * - Stored under `sites/<slug>/iter-<N>/`.
 * - Metadata persisted to `diff_artworks` (one row per site+iteration).
 * - Updates `iteration_snapshots.diff_art_*_r2_key` so the replay timeline
 *   can pull the artwork without a second lookup.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbInsert, dbExecute } from '../services/db.js';

const diffArt = new Hono<{ Bindings: Env; Variables: Variables }>();

interface SiteRow {
  id: string;
  slug: string;
  iteration_count: number | null;
}

interface DiffStats {
  files_changed: number;
  additions: number;
  deletions: number;
  churn_score: number;
}

interface ArtRequest {
  iteration?: number;
  brand_primary?: string;
  files_changed?: number;
  additions?: number;
  deletions?: number;
  churn_score?: number;
}

const PHONE_W = 1080;
const PHONE_H = 1920;
const DESKTOP_W = 2400;
const DESKTOP_H = 1260;
const OG_W = 1200;
const OG_H = 630;

function seededRng(seedHex: string): () => number {
  let state = 0;
  for (let i = 0; i < seedHex.length; i++) {
    state = (state * 31 + seedHex.charCodeAt(i)) >>> 0;
  }
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function seedHash(parts: Array<string | number>): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(parts.join('|')));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace(/^#/, '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const intVal = parseInt(full.slice(0, 6) || '000000', 16);
  return { r: (intVal >> 16) & 0xff, g: (intVal >> 8) & 0xff, b: intVal & 0xff };
}

function rgbHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

function shift(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbHex(r + amount, g + amount, b + amount);
}

function buildSvg(
  width: number,
  height: number,
  rng: () => number,
  stats: DiffStats,
  brandPrimary: string,
): string {
  const accent = shift(brandPrimary, -20);
  const highlight = shift(brandPrimary, 40);
  const bg = shift(brandPrimary, -90);

  const churn = clamp(stats.churn_score, 0, 100);
  const ringCount = clamp(8 + Math.round(churn / 4), 8, 32);
  const additions = stats.additions;
  const deletions = stats.deletions;

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.46;

  const rings: string[] = [];
  for (let i = 0; i < ringCount; i++) {
    const t = i / ringCount;
    const r = maxR * (0.18 + t * 0.82);
    const stroke = i % 2 === 0 ? accent : highlight;
    const opacity = (0.22 + rng() * 0.5).toFixed(2);
    const dash = `${(8 + rng() * 36).toFixed(1)} ${(4 + rng() * 18).toFixed(1)}`;
    const rot = (rng() * 360).toFixed(1);
    rings.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" ` +
        `fill="none" stroke="${stroke}" stroke-width="${(1 + rng() * 3).toFixed(2)}" ` +
        `stroke-dasharray="${dash}" opacity="${opacity}" ` +
        `transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})" />`,
    );
  }

  const addDots: string[] = [];
  const dotCount = clamp(Math.round(additions / 4), 6, 220);
  for (let i = 0; i < dotCount; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = maxR * (0.2 + rng() * 0.78);
    const dx = cx + Math.cos(ang) * dist;
    const dy = cy + Math.sin(ang) * dist;
    addDots.push(
      `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${(1.4 + rng() * 3).toFixed(2)}" ` +
        `fill="${highlight}" opacity="${(0.5 + rng() * 0.5).toFixed(2)}" />`,
    );
  }

  const delLines: string[] = [];
  const lineCount = clamp(Math.round(deletions / 6), 4, 80);
  for (let i = 0; i < lineCount; i++) {
    const x1 = rng() * width;
    const y1 = rng() * height;
    const len = 12 + rng() * 60;
    const ang = rng() * Math.PI * 2;
    const x2 = x1 + Math.cos(ang) * len;
    const y2 = y1 + Math.sin(ang) * len;
    delLines.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
        `stroke="${accent}" stroke-width="${(0.6 + rng() * 1.4).toFixed(2)}" ` +
        `stroke-linecap="round" opacity="${(0.3 + rng() * 0.4).toFixed(2)}" />`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<defs>`,
    `<radialGradient id="bg" cx="50%" cy="50%" r="65%">`,
    `<stop offset="0%" stop-color="${shift(brandPrimary, -40)}" />`,
    `<stop offset="100%" stop-color="${bg}" />`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" fill="url(#bg)" />`,
    rings.join(''),
    delLines.join(''),
    addDots.join(''),
    `<text x="${(width - 24).toFixed(1)}" y="${(height - 24).toFixed(1)}" ` +
      `text-anchor="end" font-family="JetBrains Mono, monospace" font-size="${Math.max(14, Math.round(width / 60))}" ` +
      `fill="${highlight}" opacity="0.7">+${additions} −${deletions} · churn ${churn.toFixed(0)}</text>`,
    `</svg>`,
  ].join('');
}

diffArt.post('/api/diff-art/:slug/generate', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.json({ error: 'missing slug' }, 400);

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, iteration_count FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);

  const body = await c.req.json<ArtRequest>().catch(() => ({}) as ArtRequest);
  const iteration = body.iteration ?? site.iteration_count ?? 1;
  const brandPrimary = (body.brand_primary || '#7c3aed').slice(0, 9);
  const stats: DiffStats = {
    files_changed: Math.max(0, body.files_changed ?? 0),
    additions: Math.max(0, body.additions ?? 0),
    deletions: Math.max(0, body.deletions ?? 0),
    churn_score: clamp(body.churn_score ?? 0, 0, 100),
  };

  const hash = await seedHash([
    site.id,
    iteration,
    stats.files_changed,
    stats.additions,
    stats.deletions,
    stats.churn_score,
    brandPrimary,
  ]);

  const variants = [
    { name: 'phone', w: PHONE_W, h: PHONE_H, col: 'diff_art_phone_r2_key' },
    { name: 'desktop', w: DESKTOP_W, h: DESKTOP_H, col: 'diff_art_desktop_r2_key' },
    { name: 'og', w: OG_W, h: OG_H, col: 'diff_art_og_r2_key' },
  ] as const;

  const keys: Record<string, string> = {};
  for (const v of variants) {
    const rng = seededRng(hash + ':' + v.name);
    const svg = buildSvg(v.w, v.h, rng, stats, brandPrimary);
    const key = `sites/${slug}/iter-${iteration}/art-${v.name}.svg`;
    await c.env.SITES_BUCKET.put(key, svg, {
      httpMetadata: { contentType: 'image/svg+xml', cacheControl: 'public, max-age=31536000, immutable' },
    });
    keys[v.name] = key;
  }

  const existing = await dbQueryOne<{ id: number }>(
    c.env.DB,
    'SELECT id FROM diff_artworks WHERE site_id = ? AND iteration = ?',
    [site.id, iteration],
  );

  if (existing) {
    await dbExecute(
      c.env.DB,
      `UPDATE diff_artworks
       SET seed_hash = ?, brand_primary = ?, files_changed = ?, additions = ?, deletions = ?, churn_score = ?
       WHERE id = ?`,
      [hash, brandPrimary, stats.files_changed, stats.additions, stats.deletions, stats.churn_score, existing.id],
    );
  } else {
    await dbInsert(c.env.DB, 'diff_artworks', {
      site_id: site.id,
      iteration,
      seed_hash: hash,
      brand_primary: brandPrimary,
      files_changed: stats.files_changed,
      additions: stats.additions,
      deletions: stats.deletions,
      churn_score: stats.churn_score,
    });
  }

  await dbExecute(
    c.env.DB,
    `UPDATE iteration_snapshots
     SET diff_art_phone_r2_key = ?, diff_art_desktop_r2_key = ?, diff_art_og_r2_key = ?
     WHERE site_id = ? AND iteration = ?`,
    [keys.phone, keys.desktop, keys.og, site.id, iteration],
  );

  return c.json({
    ok: true,
    site_id: site.id,
    iteration,
    seed_hash: hash,
    keys,
    stats,
  });
});

diffArt.get('/api/diff-art/:slug/:iteration', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  if (!slug || !Number.isFinite(iteration)) return c.json({ error: 'bad params' }, 400);

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, iteration_count FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);

  const row = await dbQueryOne<{
    seed_hash: string;
    brand_primary: string;
    files_changed: number;
    additions: number;
    deletions: number;
    churn_score: number;
  }>(
    c.env.DB,
    'SELECT seed_hash, brand_primary, files_changed, additions, deletions, churn_score FROM diff_artworks WHERE site_id = ? AND iteration = ?',
    [site.id, iteration],
  );
  if (!row) return c.json({ error: 'not generated' }, 404);

  return c.json({
    ok: true,
    iteration,
    keys: {
      phone: `sites/${slug}/iter-${iteration}/art-phone.svg`,
      desktop: `sites/${slug}/iter-${iteration}/art-desktop.svg`,
      og: `sites/${slug}/iter-${iteration}/art-og.svg`,
    },
    ...row,
  });
});

export { diffArt };
