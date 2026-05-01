/**
 * @module services/benchmark
 * @description Per-build quantitative benchmark scoring. Powers the project-local
 * learning loop in `apps/project-sites/.claude/skills/learned/`.
 *
 * Cost discipline: tiers 1-2 are free. Tier 3 (gpt-4o-mini) only fires when
 * mean(tier1, tier2) < 0.7, indicating regression.
 *
 * | Tier | Source                        | Cost        | What it scores                           |
 * |------|-------------------------------|-------------|------------------------------------------|
 * | 1    | HTML parse (HTMLRewriter)     | $0          | meta lengths, h1 count, JSON-LD, alt text|
 * | 2    | PageSpeed Insights API        | $0 (25k/d)  | perf, a11y, seo, best-practices          |
 * | 3    | gpt-4o-mini (regressions only)| ~$0.0005    | qualitative diff vs last good build      |
 *
 * Tiers 4-5 (Workers AI LLaVA, gpt-4o full) require screenshots and are deferred
 * until a Browser Rendering binding is wired. Container already does GPT-4o
 * visual inspection during the build itself; benchmark consumes that score
 * via the upload callback.
 */

import { dbInsert } from './db.js';
import type { Env } from '../types/env.js';

export interface ProgrammaticFindings {
  /** Number of `<img>` tags. */
  imageCount: number;
  /** Number of `<img>` tags missing `alt`. */
  imagesMissingAlt: number;
  /** Count of `<h1>` tags (target: exactly 1). */
  h1Count: number;
  /** Number of `<script type="application/ld+json">` blocks (target: >=4). */
  jsonLdBlocks: number;
  /** Title length in chars (target: 50-60). */
  titleLength: number;
  /** Meta description length (target: 120-156). */
  metaDescriptionLength: number;
  /** Whether `<meta name="color-scheme">` is present. */
  hasColorScheme: boolean;
  /** Internal hyperlink count. */
  internalLinks: number;
  /** External hyperlink count. */
  externalLinks: number;
  /** Banned-word hits found in body text. */
  bannedWordHits: string[];
  /** Computed score 0-1. */
  score: number;
}

const BANNED_WORDS = [
  'limitless',
  'revolutionize',
  'cutting-edge',
  'leverage',
  'world-class',
  'best-in-class',
  'turnkey',
  'synergy',
  'disrupt',
  'empower',
  'seamless',
  'robust',
  'scalable',
  'unleash',
  'unlock',
  'transform',
  'reimagine',
  'redefine',
  'transcend',
];

/**
 * Tier 1: programmatic DOM/CSS heuristics. Pure HTML parsing, no network beyond
 * the initial HTML fetch. ~1-2 seconds.
 */
export async function tierProgrammatic(siteUrl: string): Promise<ProgrammaticFindings> {
  const res = await fetch(siteUrl, {
    headers: { 'user-agent': 'project-sites-benchmark/1.0' },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) {
    throw new Error(`benchmark.fetch_failed status=${res.status} url=${siteUrl}`);
  }
  const html = await res.text();
  return parseHtmlForFindings(html, siteUrl);
}

/** Pure function — extracted for testability. */
export function parseHtmlForFindings(html: string, siteUrl: string): ProgrammaticFindings {
  const lowercase = html.toLowerCase();
  const imageCount = (html.match(/<img\b/gi) || []).length;
  const imagesMissingAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length;
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const jsonLdBlocks = (html.match(/<script\b[^>]*type=["']application\/ld\+json["']/gi) || []).length;

  const titleMatch = html.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  const titleLength = titleMatch ? titleMatch[1].trim().length : 0;

  const metaDescMatch = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const metaDescriptionLength = metaDescMatch ? metaDescMatch[1].trim().length : 0;

  const hasColorScheme = /<meta\b[^>]*name=["']color-scheme["']/i.test(html);

  const host = (() => {
    try {
      return new URL(siteUrl).host;
    } catch {
      return '';
    }
  })();
  const links = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)).map((m) => m[1]);
  let internalLinks = 0;
  let externalLinks = 0;
  for (const href of links) {
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (href.startsWith('/') || (host && href.includes(host))) internalLinks++;
    else if (href.startsWith('http')) externalLinks++;
  }

  const bannedWordHits: string[] = [];
  for (const word of BANNED_WORDS) {
    if (lowercase.includes(word)) bannedWordHits.push(word);
  }

  const score = computeProgrammaticScore({
    imageCount,
    imagesMissingAlt,
    h1Count,
    jsonLdBlocks,
    titleLength,
    metaDescriptionLength,
    hasColorScheme,
    internalLinks,
    externalLinks,
    bannedWordHits,
    score: 0,
  });

  return {
    imageCount,
    imagesMissingAlt,
    h1Count,
    jsonLdBlocks,
    titleLength,
    metaDescriptionLength,
    hasColorScheme,
    internalLinks,
    externalLinks,
    bannedWordHits,
    score,
  };
}

/** Composite score from individual checks. Each check is 0 or 1; mean is the result. */
function computeProgrammaticScore(f: ProgrammaticFindings): number {
  const checks = [
    f.h1Count === 1 ? 1 : 0,
    f.jsonLdBlocks >= 4 ? 1 : 0,
    f.titleLength >= 50 && f.titleLength <= 60 ? 1 : 0,
    f.metaDescriptionLength >= 120 && f.metaDescriptionLength <= 156 ? 1 : 0,
    f.hasColorScheme ? 1 : 0,
    f.imagesMissingAlt === 0 ? 1 : 0,
    f.imageCount >= 10 ? 1 : 0,
    f.internalLinks >= 2 ? 1 : 0,
    f.externalLinks >= 1 ? 1 : 0,
    f.bannedWordHits.length === 0 ? 1 : 0,
  ];
  return checks.reduce((a, b) => a + b, 0) / checks.length;
}

export interface PsiScores {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  raw: unknown;
}

/**
 * Tier 2: PageSpeed Insights API. Free up to 25k requests/day with key.
 * Returns scores in 0-1 range (PSI returns 0-100; we normalize).
 */
export async function tierPsi(siteUrl: string, apiKey: string | undefined): Promise<PsiScores> {
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.searchParams.set('url', siteUrl);
  url.searchParams.set('strategy', 'mobile');
  for (const cat of ['performance', 'accessibility', 'seo', 'best-practices']) {
    url.searchParams.append('category', cat);
  }
  if (apiKey) url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`benchmark.psi_failed status=${res.status} url=${siteUrl}`);
  }
  const body = (await res.json()) as { lighthouseResult?: { categories?: Record<string, { score: number | null }> } };
  const cats = body.lighthouseResult?.categories || {};
  return {
    performance: cats.performance?.score ?? null,
    accessibility: cats.accessibility?.score ?? null,
    seo: cats.seo?.score ?? null,
    bestPractices: cats['best-practices']?.score ?? null,
    raw: body,
  };
}

export interface BenchmarkResult {
  siteId: string;
  slug: string;
  programmatic: ProgrammaticFindings;
  psi: PsiScores | null;
  meanScore: number;
  regressedFromPrevious: boolean;
}

/**
 * Run all free tiers, aggregate scores, persist to D1. Returns the result so
 * the caller can decide whether to fire the paid retrospective tier.
 */
export async function runBenchmarks(args: {
  env: Env;
  siteId: string;
  slug: string;
  siteUrl: string;
  previousMeanScore?: number | null;
}): Promise<BenchmarkResult> {
  const { env, siteId, slug, siteUrl, previousMeanScore } = args;

  const programmatic = await tierProgrammatic(siteUrl);

  let psi: PsiScores | null = null;
  try {
    psi = await tierPsi(siteUrl, env.PAGESPEED_API_KEY);
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'benchmark',
      message: 'PSI tier failed, continuing without it',
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  const psiScores = psi ? [psi.performance, psi.accessibility, psi.seo, psi.bestPractices].filter((n): n is number => n !== null) : [];
  const allScores = [programmatic.score, ...psiScores];
  const meanScore = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  const regressedFromPrevious = previousMeanScore != null && meanScore < previousMeanScore - 0.1;

  await dbInsert(env.DB, 'site_benchmarks', {
    id: crypto.randomUUID(),
    site_id: siteId,
    slug,
    score_programmatic: programmatic.score,
    programmatic_findings_json: JSON.stringify(programmatic),
    score_perf: psi?.performance ?? null,
    score_a11y: psi?.accessibility ?? null,
    score_seo: psi?.seo ?? null,
    score_best_practices: psi?.bestPractices ?? null,
    psi_raw_json: psi ? JSON.stringify(psi.raw) : null,
    mean_score: meanScore,
    regressed_from_previous: regressedFromPrevious ? 1 : 0,
  });

  return { siteId, slug, programmatic, psi, meanScore, regressedFromPrevious };
}
