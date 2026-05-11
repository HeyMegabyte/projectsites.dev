#!/usr/bin/env node
// validate-mission-doctrine.mjs — soft info-mode validator.
//
// Reads _iteration_log.json.mission_doctrine_scores[] (written by Phase-2
// audit subagents: visual-qa, seo-auditor, performance-profiler,
// accessibility-auditor, content-writer) and verifies all 5 HOLIEST /
// HIGHEST B-ORDER mandates were graded >= MANDATE_FLOOR (default 8/10):
//
//   1. cinematic_floor      — open with motion, video, parallax, depth
//   2. latest_tech_flex     — WebGPU/View Transitions/scroll-driven/anchor pos/OKLCH/etc.
//   3. every_free_api       — DALL-E + Unsplash/Pexels + ElevenLabs + Mapbox + ...
//   4. flex_on_whitehouse   — head-to-head polish vs. whitehouse.gov/linear/stripe/vercel/apple
//   5. platform_promise     — free site == paid site quality; auto-boost loop visible
//
// Exit code is ALWAYS 0 (info-mode) — emits a warnings array that
// completeness-checker promotes to a blocker. Soft gate so craftsmanship
// is trained, not punished. Hard gate would discourage exploration.
//
// Usage: node scripts/validate-mission-doctrine.mjs [build_root]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MANDATES = [
  'cinematic_floor',
  'latest_tech_flex',
  'every_free_api',
  'flex_on_whitehouse',
  'platform_promise',
];
const MANDATE_FLOOR = Number(process.env.MISSION_DOCTRINE_FLOOR ?? 8);

const argDir = resolve(process.argv[2] ?? '.');
if (!existsSync(argDir) || !statSync(argDir).isDirectory()) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: `not a directory: ${argDir}` }));
  process.exit(0);
}

const logPath = join(argDir, '_iteration_log.json');
if (!existsSync(logPath)) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: '_iteration_log.json not found (Phase-2 audits not yet run)',
    build_root: argDir,
  }));
  process.exit(0);
}

let log;
try {
  log = JSON.parse(readFileSync(logPath, 'utf8'));
} catch (e) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: `_iteration_log.json parse: ${e.message}` }));
  process.exit(0);
}

const current = Array.isArray(log) ? log[log.length - 1] : log.current ?? log;
const scores = current?.mission_doctrine_scores ?? [];

if (!Array.isArray(scores) || scores.length === 0) {
  console.log(JSON.stringify({
    ok: true,
    warnings: [{
      code: 'mission_doctrine.scores_missing',
      severity: 'info',
      message: 'mission_doctrine_scores[] not yet populated by Phase-2 audits. visual-qa/seo-auditor/performance-profiler/accessibility-auditor/content-writer must each emit one entry per mandate.',
    }],
    build_root: argDir,
  }, null, 2));
  process.exit(0);
}

const byMandate = Object.fromEntries(MANDATES.map((m) => [m, []]));
for (const s of scores) {
  if (s?.mandate && byMandate[s.mandate]) {
    byMandate[s.mandate].push(s);
  }
}

const warnings = [];
const summary = {};
for (const mandate of MANDATES) {
  const entries = byMandate[mandate];
  if (entries.length === 0) {
    warnings.push({
      code: `mission_doctrine.${mandate}.ungraded`,
      severity: 'info',
      mandate,
      message: `Mandate "${mandate}" not graded by any Phase-2 audit subagent.`,
    });
    summary[mandate] = { graded: false };
    continue;
  }
  const scoresArr = entries.map((e) => Number(e.score) || 0);
  const avg = scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length;
  const min = Math.min(...scoresArr);
  summary[mandate] = { graded: true, n: entries.length, avg: +avg.toFixed(2), min, floor: MANDATE_FLOOR };
  if (avg < MANDATE_FLOOR) {
    warnings.push({
      code: `mission_doctrine.${mandate}.below_floor`,
      severity: 'info',
      mandate,
      avg: +avg.toFixed(2),
      floor: MANDATE_FLOOR,
      message: `Mandate "${mandate}" avg ${avg.toFixed(2)}/10 below floor ${MANDATE_FLOOR}/10. Re-iterate to lift craft.`,
      remediation_hints: hintsFor(mandate),
    });
  }
}

console.log(JSON.stringify({
  ok: true,
  validator: 'validate-mission-doctrine',
  build_root: argDir,
  floor: MANDATE_FLOOR,
  summary,
  warnings,
  graded_count: scores.length,
}, null, 2));

process.exit(0);

function hintsFor(mandate) {
  return {
    cinematic_floor: ['add hero video w/ autoplay+muted+loop+preload=metadata', 'add scroll-driven parallax to one section', 'add View Transitions on internal nav'],
    latest_tech_flex: ['use OKLCH for ≥1 brand color', 'enable container queries on the main grid', 'add :has() parent selector somewhere', 'add anchor positioning on a tooltip or popover'],
    every_free_api: ['add Mapbox/Google Maps embed', 'add Lottie animation', 'add NotebookLM podcast artifact link', 'add Unsplash/Pexels fallback for any missing hero image'],
    flex_on_whitehouse: ['raise type density: 2 columns of body copy with proper measure', 'add 3+ JSON-LD blocks beyond WebSite/Org', 'add Server-Timing headers per route'],
    platform_promise: ['ensure free vs. paid output IDENTICAL (no watermark, no fewer pages)', 'expose iteration_count + delight_moments on /showcase', 'wire auto-boost CTA to /api/sites/:id/reboost'],
  }[mandate] ?? [];
}
