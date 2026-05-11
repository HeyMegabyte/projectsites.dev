#!/usr/bin/env node
// validate-delight-moments.mjs — soft info-mode validator.
//
// Reads _iteration_log.json.delight_moments[] and verifies the floor
//   min(iteration_count + 1, 6)
// is met for the current build. Each entry must be `{ slug, route,
// description, evidence_selector }` (creativity-doctrine rule).
//
// Exit code is ALWAYS 0 (info-mode) — emits a warning instead.
// Soft gate per ~/.claude/rules/creativity-doctrine.md:
// "Hard gate would discourage craftsmanship; warning gate trains the loop."
//
// Usage: node scripts/validate-delight-moments.mjs [build_root]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
    reason: '_iteration_log.json not found',
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
const iterationCount = Number(current?.iteration_count ?? 0);
const moments = Array.isArray(current?.delight_moments) ? current.delight_moments : [];
const floor = Math.min(iterationCount + 1, 6);

const warnings = [];
if (moments.length < floor) {
  warnings.push({
    code: 'creativity.delight_floor_missed',
    severity: 'info',
    floor,
    found: moments.length,
    iteration_count: iterationCount,
    message: `Delight floor ${floor} missed (found ${moments.length}). Add at least ${floor - moments.length} more before declaring done — clever microcopy, micro-animation, thoughtful empty state, hover-reveal, parallax beat, easter egg, success chime.`,
  });
}

// Shape check on each moment.
const required = ['slug', 'route', 'description', 'evidence_selector'];
const malformed = [];
for (const [i, m] of moments.entries()) {
  if (!m || typeof m !== 'object') {
    malformed.push({ index: i, reason: 'not an object' });
    continue;
  }
  const missing = required.filter((k) => !m[k] || typeof m[k] !== 'string');
  if (missing.length) malformed.push({ index: i, missing });
}
if (malformed.length) {
  warnings.push({
    code: 'creativity.delight_shape_invalid',
    severity: 'info',
    malformed,
    message: 'Each delight_moments[] entry must be { slug, route, description, evidence_selector }.',
  });
}

console.log(JSON.stringify({
  ok: true,
  validator: 'validate-delight-moments',
  build_root: argDir,
  iteration_count: iterationCount,
  floor,
  found: moments.length,
  warnings,
}, null, 2));

process.exit(0);
