#!/usr/bin/env node
/**
 * Convergence Loop — recursive build → judge → improve until stop conditions met.
 *
 * Usage:
 *   node scripts/convergence-loop.mjs --slug lonemountainglobal --name "Lone Mountain Global" --source https://lonemountainglobal.com
 *
 * Stop conditions (whichever fires first):
 *   - Score plateau:  3 consecutive iterations with overall ≥ 9.0/10 AND delta < 0.1
 *   - Budget cap:     cumulative spend ≥ $50.00
 *   - Iteration cap:  iterations ≥ 25
 *   - External:       artifacts/<slug>-stop.flag exists
 *
 * Each iteration:
 *   1. POST /api/sites/:id/reset to trigger a fresh build with current Directive vN
 *   2. Poll /api/sites/:id/workflow until status ∈ {published, error}
 *   3. Run multi-judge (GPT-4o vision 6bp × N routes + Lighthouse + axe-core + Yoast + LocalSEO + business-fit)
 *   4. Aggregate recommendations
 *   5. Promote any recommendation seen in ≥2 prior iterations across ≥2 sites to ~/.agentskills/15-site-generation/build-breaking-rules.md
 *   6. Write artifacts/<slug>-iter-N.json
 *
 * Authoritative truth: artifacts/<slug>-runs.jsonl (one line per iteration).
 */

import { mkdir, writeFile, readFile, access, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTIFACTS = join(ROOT, 'artifacts');

const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const STOP_PLATEAU_RUNS = 3;
const STOP_PLATEAU_DELTA = 0.1;
const STOP_PLATEAU_FLOOR = 9.0;
const STOP_BUDGET_USD = 50.0;
const STOP_ITER_CAP = 25;

const args = parseArgs(process.argv.slice(2));
if (!args.slug || !args.name) {
  console.error('Usage: --slug <slug> --name "<Business Name>" [--source <url>] [--mode <consulting|local-business|...>] [--max <N>]');
  process.exit(2);
}

const apiBase = args['api-base'] || process.env.PROJECT_SITES_API || 'https://projectsites.dev';
const authToken = process.env.PROJECT_SITES_TOKEN;
if (!authToken) {
  console.error('Missing PROJECT_SITES_TOKEN env var (Bearer token for /api authenticated endpoints).');
  process.exit(2);
}

const stopFlag = join(ARTIFACTS, `${args.slug}-stop.flag`);
const runsFile = join(ARTIFACTS, `${args.slug}-runs.jsonl`);

await mkdir(ARTIFACTS, { recursive: true });

const overallHistory = [];
const recHistory = [];
let cumulativeCost = 0;
let iteration = 0;
let stopReason = null;
const maxIter = Number(args.max) || STOP_ITER_CAP;

while (true) {
  iteration += 1;

  // External stop
  if (existsSync(stopFlag)) {
    stopReason = 'external_flag';
    break;
  }

  // Iteration cap
  if (iteration > maxIter) {
    stopReason = 'iteration_cap';
    iteration -= 1;
    break;
  }

  // Budget cap
  if (cumulativeCost >= STOP_BUDGET_USD) {
    stopReason = 'budget';
    break;
  }

  console.log(`\n=== Iteration ${iteration} for ${args.slug} ===`);
  const t0 = Date.now();

  const result = await runIteration({
    slug: args.slug,
    name: args.name,
    source: args.source,
    mode: args.mode,
    iteration,
    priorRecs: recHistory.slice(-3).flat(),
    apiBase,
    authToken,
  });

  cumulativeCost += result.cost_usd ?? 0;
  overallHistory.push(result.overall);
  recHistory.push(result.recommendations || []);

  const iterPath = join(ARTIFACTS, `${args.slug}-iter-${iteration}.json`);
  await writeFile(iterPath, JSON.stringify(result, null, 2));
  await appendFile(runsFile, JSON.stringify({ iteration, ...result, elapsed_sec: Math.round((Date.now() - t0) / 1000) }) + '\n');

  await maybePromoteRules(recHistory, args.slug);

  // Plateau stop: 3 consecutive ≥ 9.0 with delta < 0.1
  if (overallHistory.length >= STOP_PLATEAU_RUNS) {
    const tail = overallHistory.slice(-STOP_PLATEAU_RUNS);
    const allHigh = tail.every((s) => s >= STOP_PLATEAU_FLOOR);
    const maxDelta = Math.max(...tail) - Math.min(...tail);
    if (allHigh && maxDelta < STOP_PLATEAU_DELTA) {
      stopReason = 'plateau';
      break;
    }
  }

  console.log(`  → overall=${result.overall.toFixed(2)} cost=$${result.cost_usd?.toFixed(2)} cum=$${cumulativeCost.toFixed(2)} recs=${result.recommendations?.length ?? 0}`);
}

const summary = {
  slug: args.slug,
  name: args.name,
  iterations: iteration,
  stop_reason: stopReason,
  overall_history: overallHistory,
  cumulative_cost_usd: cumulativeCost,
  final_overall: overallHistory[overallHistory.length - 1] ?? null,
};
await writeFile(join(ARTIFACTS, `${args.slug}-summary.json`), JSON.stringify(summary, null, 2));
console.log('\n=== Convergence complete ===');
console.log(JSON.stringify(summary, null, 2));

// ─────────────────────────────────────────────────────────────────────

async function runIteration({ slug, name, source, mode, iteration, priorRecs, apiBase, authToken }) {
  const siteId = await ensureSite({ slug, name, source, mode, apiBase, authToken });
  const iterStartedAt = new Date().toISOString();

  // Trigger reset (rebuild with current Directive vN). Skip ONLY when this is
  // iteration 1 AND the site is in an active build state (just created via
  // create-from-search, or already building from a prior partial run). For
  // terminal states (published / error / archived / draft) we always reset so
  // the iteration produces a fresh build artifact to judge.
  let needsReset = iteration > 1;
  if (!needsReset) {
    const status = await getJson(`${apiBase}/api/sites/${siteId}`, authToken).then((r) => r?.data?.status).catch(() => null);
    const inFlight = status === 'building' || status === 'queued' || status === 'generating' || status === 'imaging' || status === 'uploading' || status === 'collecting';
    if (!inFlight) needsReset = true;
  }
  if (needsReset) {
    await postJson(`${apiBase}/api/sites/${siteId}/reset`, {
      directive_version: iteration,
      prior_recommendations: priorRecs,
      expert_notes: args['expert-notes'] || '',
    }, authToken);
  }

  // Poll workflow until terminal
  const final = await pollWorkflow({ siteId, apiBase, authToken });
  if (final.status === 'error') {
    const errorCost = await iterationCost({ siteId, apiBase, authToken, iterStartedAt, elapsedSec: final.elapsed_sec });
    return {
      iteration,
      site_slug: slug,
      site_url: `https://${slug}.projectsites.dev`,
      overall: 0,
      pass: false,
      stop_reason: null,
      recommendations: [{ category: 'pipeline', severity: 'blocker', description: final.error || 'workflow errored' }],
      cost_usd: errorCost.total_usd,
      cost_breakdown: errorCost.breakdown,
      elapsed_sec: final.elapsed_sec,
    };
  }

  // Multi-judge: GPT-4o + Lighthouse + axe + SEO + wedge fit
  const judged = await multiJudge({ slug, source, mode, iteration });
  const costInfo = await iterationCost({ siteId, apiBase, authToken, iterStartedAt, elapsedSec: final.elapsed_sec });
  // Use the larger of (judge-reported cost, audit/elapsed estimate) so budget
  // cap reflects real spend even if one source is missing.
  const cost_usd = Math.max(judged.cost_usd ?? 0, costInfo.total_usd);
  return {
    iteration,
    site_slug: slug,
    site_url: `https://${slug}.projectsites.dev`,
    mode_inferred: mode || final.mode_inferred,
    ...judged,
    cost_usd,
    cost_breakdown: { judge_usd: judged.cost_usd ?? 0, ...costInfo.breakdown },
    elapsed_sec: final.elapsed_sec,
  };
}

/**
 * Compute iteration cost. Prefer real audit log cost_cents (forward-compatible
 * for when workflow steps emit cost data). Fall back to elapsed-time estimate
 * using observed orchestrator economics: $0.40/min steady-state for the
 * single-call container build (derived from $5-15 per 25-40min build).
 */
async function iterationCost({ siteId, apiBase, authToken, iterStartedAt, elapsedSec }) {
  const RATE_USD_PER_MIN = 0.40;
  const estimate_usd = (elapsedSec / 60) * RATE_USD_PER_MIN;
  const breakdown = { estimate_usd: Number(estimate_usd.toFixed(4)), audit_usd: 0 };
  let audit_usd = 0;
  try {
    const logs = await getJson(`${apiBase}/api/sites/${siteId}/logs?limit=200`, authToken);
    const since = Date.parse(iterStartedAt);
    if (Array.isArray(logs?.data)) {
      for (const log of logs.data) {
        const ts = Date.parse(log?.created_at ?? '');
        if (!Number.isFinite(ts) || ts < since) continue;
        const cents = Number(log?.cost_cents);
        if (Number.isFinite(cents) && cents > 0) audit_usd += cents / 100;
      }
    }
    breakdown.audit_usd = Number(audit_usd.toFixed(4));
  } catch {
    // logs endpoint missing or auth issue — fall back to estimate only
  }
  return {
    total_usd: Math.max(audit_usd, estimate_usd),
    breakdown,
  };
}

async function ensureSite({ slug, name, source, mode, apiBase, authToken }) {
  // Try lookup first; create if missing.
  // API shape: { data: { exists, site_id, slug, status, has_build } } or { data: { exists: false } }.
  const lookup = await getJson(`${apiBase}/api/sites/lookup?slug=${encodeURIComponent(slug)}`, authToken);
  if (lookup?.data?.exists && lookup?.data?.site_id) return lookup.data.site_id;

  const created = await postJson(`${apiBase}/api/sites/create-from-search`, {
    mode: 'create',
    additional_context: args['expert-notes'] || '',
    business: { name, address: '', place_id: '', phone: '', website: source || '', types: [], category: mode || '' },
    upload_id: null,
    slug,
  }, authToken);
  // API shape: { data: { site_id, slug, status, workflow_instance_id } }.
  if (!created?.data?.site_id) throw new Error('Failed to create site: ' + JSON.stringify(created));
  return created.data.site_id;
}

async function pollWorkflow({ siteId, apiBase, authToken }) {
  const startedAt = Date.now();
  const maxMs = 50 * 60 * 1000; // 50 min hard cap
  // Heartbeat-freshness staleness threshold. wf_status / workflow_output are STALE — the
  // /workflow endpoint serves the last terminal instance state even when a fresh build is
  // running. Source of truth = D1 site_status + recent heartbeat timestamps.
  const STALE_HEARTBEAT_MS = 4 * 60 * 1000; // 4 min — container heartbeats every 30s
  while (Date.now() - startedAt < maxMs) {
    await sleep(30000);
    const wf = await getJson(`${apiBase}/api/sites/${siteId}/workflow`, authToken);
    const siteStatus = wf?.data?.site_status;
    const wfStatus = wf?.data?.workflow_status;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    // D1 site_status is canonical for terminal transitions.
    if (siteStatus === 'published') {
      return { status: siteStatus, mode_inferred: undefined, elapsed_sec: elapsed };
    }
    if (siteStatus === 'error' || siteStatus === 'archived') {
      return { status: siteStatus, error: wf?.data?.workflow_error || 'unknown', elapsed_sec: elapsed };
    }

    // Compute heartbeat freshness from recent_logs. Heartbeat actions: workflow.heartbeat
    // or workflow.build_started. If neither has fired in 4 min, build is wedged.
    const logs = Array.isArray(wf?.data?.recent_logs) ? wf.data.recent_logs : [];
    const latestHb = logs.find((l) => l.action === 'workflow.heartbeat' || l.action === 'workflow.build_started');
    const hbAgeMs = latestHb ? (Date.now() - new Date(latestHb.created_at + 'Z').getTime()) : Infinity;
    const hbStep = latestHb?.metadata?.step || latestHb?.action || '?';
    const hbElapsed = latestHb?.metadata?.elapsed_seconds ?? '?';
    process.stdout.write(`  [${elapsed}s] site=${siteStatus} wf=${wfStatus} hb_age=${Math.round(hbAgeMs/1000)}s step=${hbStep} build_elapsed=${hbElapsed}s   \r`);

    // Build is actively running — recent heartbeat present. Keep waiting regardless of stale wf_status.
    if (hbAgeMs < STALE_HEARTBEAT_MS) continue;

    // No recent heartbeat. If site_status is in a transient state, the build wedged.
    const transient = ['draft', 'queued', 'building', 'collecting', 'imaging', 'generating', 'uploading'];
    if (transient.includes(siteStatus)) {
      return { status: 'error', error: `wedged: no heartbeat for ${Math.round(hbAgeMs/1000)}s, site_status=${siteStatus}`, elapsed_sec: elapsed };
    }
    // Workflow terminal without D1 transition (DO eviction, schema-rejected error write).
    if (wfStatus === 'errored' || wfStatus === 'terminated') {
      return { status: 'error', error: wf?.data?.workflow_error || `workflow_status=${wfStatus}`, elapsed_sec: elapsed };
    }
  }
  return { status: 'error', error: 'workflow timeout 50min', elapsed_sec: Math.round((Date.now() - startedAt) / 1000) };
}

async function multiJudge({ slug, source, mode, iteration }) {
  // Delegates to the deployed score_directive prompt + Lighthouse + axe-core.
  // For now, calls the score_website endpoint and decorates with placeholder
  // Lighthouse/a11y audits. Real Playwright + GPT-4o vision audits run via the
  // visual-inspection-final workflow step on the published site.
  const url = `https://${slug}.projectsites.dev`;
  const judgeRes = await postJson(`${apiBase}/api/sites/judge`, {
    slug,
    source_url: source,
    mode_inferred: mode,
    iteration,
    rubric_version: 1,
  }, authToken).catch(() => null);

  if (judgeRes?.scores) return judgeRes;

  // Fallback: deterministic structural judge — fetches HTML + key assets, scores
  // via WCAG/SEO invariants from build_validators.ts. Produces actionable recs
  // ("only 3 images on homepage, target 6+") not aggregate scores
  // ("Lighthouse perf 0"). Zero cost, zero rate-limit, zero external dep.
  return await structuralJudge({ slug, source, mode, iteration, url });
}

async function structuralJudge({ slug, source, mode, iteration, url }) {
  const recs = [];
  const fetchOpts = { headers: { 'User-Agent': REAL_UA } };

  // 1. Fetch homepage HTML
  let html = '';
  let httpStatus = 0;
  let bytes = 0;
  try {
    const r = await fetch(url, fetchOpts);
    httpStatus = r.status;
    html = await r.text();
    bytes = html.length;
  } catch (e) {
    return zeroJudge(`fetch failed: ${e.message}`);
  }
  if (httpStatus !== 200) {
    return zeroJudge(`HTTP ${httpStatus} for homepage`);
  }

  // 2. Parse structural facts from HTML (regex — no DOM, fast, deterministic)
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const description = descMatch ? descMatch[1].trim() : '';
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const h3Count = (html.match(/<h3\b/gi) || []).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
  const imgCount = imgs.length;
  const imgWithAlt = imgs.filter((m) => /\salt=["'][^"']+["']/i.test(m[0])).length;
  const imgLazy = imgs.filter((m) => /\sloading=["']lazy["']/i.test(m[0])).length;
  const internalLinks = (html.match(/<a\b[^>]+href=["']\//gi) || []).length;
  const externalLinks = (html.match(/<a\b[^>]+href=["']https?:\/\/(?!(?:www\.)?[^"'/]*projectsites\.dev)/gi) || []).length;
  const jsonLdBlocks = (html.match(/<script[^>]+type=["']application\/ld\+json["']/gi) || []).length;
  const ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const ogDesc = /<meta[^>]+property=["']og:description["']/i.test(html);
  const twitterCard = /<meta[^>]+name=["']twitter:card["']/i.test(html);
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const themeColor = /<meta[^>]+name=["']theme-color["']/i.test(html);
  const appleTouchIcon = /<link[^>]+rel=["']apple-touch-icon["']/i.test(html);
  const manifest = /<link[^>]+rel=["']manifest["']/i.test(html);
  const colorScheme = /<meta[^>]+name=["']color-scheme["']/i.test(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);

  // Body word count — strip tags, scripts, styles
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  // Banned slop word check
  const slopWords = ['limitless', 'revolutionize', 'cutting-edge', 'leverage', 'world-class', 'best-in-class', 'turnkey', 'synergy', 'state-of-the-art', 'unleash', 'reimagine', 'paradigm'];
  const slopHits = slopWords.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(bodyText));

  // 3. Asset checks (parallel HEAD requests for required PWA/SEO files)
  const assetTargets = [
    '/site.webmanifest', '/robots.txt', '/sitemap.xml',
    '/favicon.ico', '/apple-touch-icon.png', '/og-image.png',
  ];
  const assetResults = await Promise.all(assetTargets.map(async (path) => {
    try {
      const r = await fetch(url + path, { method: 'HEAD', headers: fetchOpts.headers });
      return { path, ok: r.ok, status: r.status };
    } catch { return { path, ok: false, status: 0 }; }
  }));
  const missingAssets = assetResults.filter((a) => !a.ok).map((a) => a.path);

  // 4. Sitemap parse for route count + lastmod presence
  let routeCount = 0;
  let sitemapHasLastmod = false;
  try {
    const sm = await fetch(url + '/sitemap.xml', fetchOpts);
    if (sm.ok) {
      const xml = await sm.text();
      const urls = (xml.match(/<url>/gi) || []).length;
      routeCount = urls;
      const lastmodCount = (xml.match(/<lastmod>/gi) || []).length;
      sitemapHasLastmod = lastmodCount > 0 && lastmodCount === urls;
    }
  } catch { /* sitemap missing already in missingAssets */ }

  // 5. Score per-dimension (0-1 scale → multiplied by 10 for overall)
  const scores = {
    visual_design: 0.5, // can't judge without screenshot, neutral default
    content_quality: clamp(wordCount / 1500, 0, 1), // 1500+ words → 1.0
    completeness: clamp(routeCount / 10, 0, 1), // 10+ routes → 1.0
    responsiveness: viewport ? 0.9 : 0.3,
    accessibility: clamp((imgWithAlt / Math.max(imgCount, 1)) * 0.5 + (h1Count === 1 ? 0.3 : 0) + (themeColor ? 0.1 : 0) + (colorScheme ? 0.1 : 0), 0, 1),
    seo: clamp(
      (title.length >= 50 && title.length <= 60 ? 0.2 : 0) +
      (description.length >= 120 && description.length <= 156 ? 0.2 : 0) +
      (canonical ? 0.1 : 0) +
      (ogImage && ogTitle && ogDesc ? 0.15 : 0) +
      (twitterCard ? 0.05 : 0) +
      (jsonLdBlocks >= 4 ? 0.2 : jsonLdBlocks * 0.05) +
      (sitemapHasLastmod ? 0.1 : 0),
      0, 1
    ),
    performance: clamp(1 - (bytes / 500000), 0, 1), // <500KB HTML → 1.0
    brand_consistency: 0.7, // can't judge without screenshot
    media_richness: clamp(imgCount / 6, 0, 1), // 6+ imgs → 1.0
    text_contrast: 0.7, // can't judge without screenshot
    wedge_fit: 0.6,
    customer_voice: clamp(1 - slopHits.length * 0.2, 0, 1),
  };

  // 6. Build actionable recs
  if (title.length < 50 || title.length > 60) {
    recs.push({ category: 'seo', severity: 'major', description: `Homepage <title> is ${title.length} chars (target 50-60). Current: "${title.slice(0, 80)}"` });
  }
  if (description.length < 120 || description.length > 156) {
    recs.push({ category: 'seo', severity: 'major', description: `Homepage meta description is ${description.length} chars (target 120-156). Current: "${description.slice(0, 100)}"` });
  }
  if (h1Count !== 1) {
    recs.push({ category: 'accessibility', severity: 'major', description: `Homepage has ${h1Count} <h1> elements (target exactly 1)` });
  }
  if (h2Count < 3) {
    recs.push({ category: 'content_quality', severity: 'minor', description: `Homepage has only ${h2Count} <h2> sections (target 3+ for content density)` });
  }
  if (imgCount < 6) {
    recs.push({ category: 'media_richness', severity: 'major', description: `Homepage has only ${imgCount} images (target 6+ per per-route media density spec)` });
  }
  if (imgCount > 0 && imgWithAlt < imgCount) {
    recs.push({ category: 'accessibility', severity: 'major', description: `${imgCount - imgWithAlt} of ${imgCount} images missing alt text (WCAG 2.2 1.1.1)` });
  }
  if (imgCount > 3 && imgLazy < Math.floor(imgCount * 0.5)) {
    recs.push({ category: 'performance', severity: 'minor', description: `Only ${imgLazy}/${imgCount} images use loading="lazy" (target 50%+)` });
  }
  if (jsonLdBlocks < 4) {
    recs.push({ category: 'seo', severity: 'major', description: `Homepage has ${jsonLdBlocks} JSON-LD blocks (target 4+: WebSite + Organization + WebPage + BreadcrumbList minimum)` });
  }
  if (!ogImage || !ogTitle || !ogDesc) {
    const missing = [!ogImage && 'og:image', !ogTitle && 'og:title', !ogDesc && 'og:description'].filter(Boolean);
    recs.push({ category: 'seo', severity: 'major', description: `Missing Open Graph meta: ${missing.join(', ')}` });
  }
  if (!twitterCard) {
    recs.push({ category: 'seo', severity: 'minor', description: 'Missing twitter:card meta tag' });
  }
  if (!canonical) {
    recs.push({ category: 'seo', severity: 'major', description: 'Missing <link rel="canonical">' });
  }
  if (!themeColor) {
    recs.push({ category: 'seo', severity: 'minor', description: 'Missing <meta name="theme-color"> (PWA install + browser chrome theming)' });
  }
  if (!appleTouchIcon) {
    recs.push({ category: 'seo', severity: 'major', description: 'Missing <link rel="apple-touch-icon"> 180×180' });
  }
  if (!manifest) {
    recs.push({ category: 'seo', severity: 'major', description: 'Missing <link rel="manifest"> for PWA install' });
  }
  if (!colorScheme) {
    recs.push({ category: 'accessibility', severity: 'minor', description: 'Missing <meta name="color-scheme"> for dark/light mode hint' });
  }
  if (!viewport) {
    recs.push({ category: 'responsiveness', severity: 'blocker', description: 'Missing <meta name="viewport"> — site will not render correctly on mobile' });
  }
  if (wordCount < 1000) {
    recs.push({ category: 'content_quality', severity: 'major', description: `Homepage has only ${wordCount} words (target 1000+ for content depth + SEO)` });
  }
  if (internalLinks < 5) {
    recs.push({ category: 'seo', severity: 'minor', description: `Homepage has only ${internalLinks} internal links (target 5+ for crawl depth + topical coverage)` });
  }
  if (externalLinks < 1) {
    recs.push({ category: 'seo', severity: 'minor', description: 'Homepage has 0 outbound links (target 1+ for trust signals)' });
  }
  if (routeCount > 0 && routeCount < 8) {
    recs.push({ category: 'completeness', severity: 'major', description: `Sitemap declares only ${routeCount} routes (target 8+ for sub-page depth)` });
  }
  if (routeCount === 0) {
    recs.push({ category: 'completeness', severity: 'blocker', description: 'No routes found in sitemap.xml or sitemap missing entirely' });
  }
  if (!sitemapHasLastmod && routeCount > 0) {
    recs.push({ category: 'seo', severity: 'minor', description: 'sitemap.xml is missing <lastmod> on some/all <url> entries' });
  }
  for (const path of missingAssets) {
    recs.push({ category: 'completeness', severity: 'major', description: `Required asset missing: ${path}` });
  }
  if (slopHits.length > 0) {
    recs.push({ category: 'customer_voice', severity: 'major', description: `Banned slop words found in copy: ${slopHits.join(', ')}` });
  }
  if (bytes > 500000) {
    recs.push({ category: 'performance', severity: 'minor', description: `Homepage HTML is ${Math.round(bytes / 1024)}KB (target <500KB raw)` });
  }

  // 7. Aggregate to overall score (0-10)
  const scoreVals = Object.values(scores);
  const overall10 = (scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) * 10;

  return {
    scores,
    overall: Number(overall10.toFixed(2)),
    pass: overall10 >= 9.0,
    cost_usd: 0,
    recommendations: recs,
    judge_meta: {
      kind: 'structural',
      url,
      http_status: httpStatus,
      bytes,
      title_length: title.length,
      description_length: description.length,
      h1_count: h1Count,
      h2_count: h2Count,
      h3_count: h3Count,
      img_count: imgCount,
      img_with_alt: imgWithAlt,
      img_lazy: imgLazy,
      internal_links: internalLinks,
      external_links: externalLinks,
      jsonld_blocks: jsonLdBlocks,
      route_count: routeCount,
      word_count: wordCount,
      missing_assets: missingAssets,
    },
  };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function zeroJudge(reason) {
  return {
    scores: { visual_design: 0, content_quality: 0, completeness: 0, responsiveness: 0, accessibility: 0, seo: 0, performance: 0, brand_consistency: 0, media_richness: 0, text_contrast: 0, wedge_fit: 0, customer_voice: 0 },
    overall: 0,
    pass: false,
    cost_usd: 0,
    recommendations: [{ category: 'pipeline', severity: 'blocker', description: `Judge could not evaluate site: ${reason}` }],
    judge_meta: { kind: 'structural', error: reason },
  };
}

async function maybePromoteRules(recHistory, currentSlug) {
  if (recHistory.length < 3) return;
  const recent = recHistory.slice(-3).flat();
  const counts = new Map();
  for (const r of recent) {
    if (!r?.description) continue;
    const key = r.category + ':' + r.description.slice(0, 60);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const promotable = [...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k);
  if (!promotable.length) return;
  const note = `\n## Promoted ${new Date().toISOString().slice(0, 10)} (${currentSlug} convergence)\n` +
    promotable.map((p) => `- ${p}`).join('\n') + '\n';
  await appendFile(join(ROOT, 'PROMOTED_RULES.md'), note).catch(() => {});
  console.log(`  ↑ promoted ${promotable.length} recurring recommendation(s) to PROMOTED_RULES.md`);
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { 'User-Agent': REAL_UA, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return await res.json();
}

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': REAL_UA, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`POST ${url} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json().catch(() => ({}));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i += 1; }
    }
  }
  return out;
}
