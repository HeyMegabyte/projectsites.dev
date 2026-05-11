#!/usr/bin/env node
/**
 * @file validate-no-placeholders.mjs
 * @module scripts/validate-no-placeholders
 *
 * @description
 * Build-breaking gate: greps `dist/**` for literal template placeholders
 * that were never substituted by the orchestrator. The 2026-05-11 09:06
 * LMG nuke shipped 13 files of raw template shell because no validator
 * existed for `{BUSINESS_NAME}` / `{BUSINESS_DESCRIPTION}` /
 * `{BUSINESS_SHORT_NAME}` etc. — the workflow flipped status to
 * `published` against an unsubstituted template skeleton. This validator
 * is the bouncer that catches that failure mode before R2 upload.
 *
 * Patterns flagged (any match = build fail):
 *   - `{UPPER_SNAKE_CASE}`            literal handlebar-style placeholder
 *   - `{{UPPER_SNAKE_CASE}}`          mustache placeholder
 *   - `<%= UPPER_SNAKE_CASE %>`       EJS placeholder
 *   - `__PLACEHOLDER__`               python-style sentinel
 *   - `lorem ipsum`                   stock filler text
 *   - `TODO:` `FIXME:`                in user-visible HTML (NOT in JS/CSS)
 *   - `[business name]` `[BUSINESS]`  bracket placeholders
 *
 * Whitelist exceptions (regex match against whole token):
 *   - `{count}` `{name}` `{n}` etc. — short single-word i18n placeholders
 *     that frameworks may legitimately leave in strings (e.g. Intl message
 *     format) — these MUST be lowercase to pass.
 *   - `{0}` `{1}` — positional placeholders.
 *
 * Exit codes:
 *   0 — clean (no placeholders)
 *   1 — placeholders found (blocks workflow)
 *   2 — directory unreadable / invalid arg
 *
 * Usage:
 *   node scripts/validate-no-placeholders.mjs [dist_dir]
 *
 * Wired into the workflow `validate-build` step (see
 * `src/workflows/site-generation.ts`) and the container `validator-fixer`
 * subagent via `scripts/run-validators.mjs`.
 *
 * @see {@link ./run-validators.mjs}
 * @see {@link ../src/services/build_validators.ts}
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const TEXT_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.md', '.svg']);
const SKIP_DIRS = new Set(['node_modules', '.git', '_src']);

const PATTERNS = [
  { name: 'handlebar_placeholder', re: /\{([A-Z][A-Z0-9_]{2,})\}/g, severity: 'error' },
  { name: 'mustache_placeholder', re: /\{\{([A-Z][A-Z0-9_]{2,})\}\}/g, severity: 'error' },
  { name: 'ejs_placeholder', re: /<%=\s*([A-Z][A-Z0-9_]+)\s*%>/g, severity: 'error' },
  { name: 'underscore_sentinel', re: /__([A-Z][A-Z0-9_]{2,})__/g, severity: 'error' },
  { name: 'bracket_business', re: /\[(BUSINESS|BUSINESS NAME|business name|YOUR BUSINESS|YOUR_BUSINESS)\]/gi, severity: 'error' },
  { name: 'lorem_ipsum', re: /\b(lorem ipsum|consectetur adipiscing)\b/gi, severity: 'error' },
  { name: 'placeholder_word', re: /\bplaceholder\s+(text|content|copy|description)\b/gi, severity: 'warning' },
];

// Tokens inside `{...}` that are LEGITIMATE (i18n / framework / CSS calc).
const HANDLEBAR_WHITELIST = new Set([
  'BUILD_VERSION', 'GIT_SHA', 'NODE_ENV',
]);

const isText = (p) => {
  const dot = p.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTS.has(p.slice(dot).toLowerCase());
};

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const distDir = resolve(process.argv[2] ?? 'dist');
if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(JSON.stringify({ ok: false, error: `not a directory: ${distDir}` }));
  process.exit(2);
}

const violations = [];
let filesScanned = 0;

for (const abs of walk(distDir)) {
  const rel = relative(distDir, abs).replaceAll('\\', '/');
  if (!isText(rel)) continue;
  if (statSync(abs).size > 4_000_000) continue;
  let body;
  try { body = readFileSync(abs, 'utf8'); } catch { continue; }
  filesScanned++;

  for (const { name, re, severity } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      const captured = m[1] ?? m[0];
      if (name === 'handlebar_placeholder' && HANDLEBAR_WHITELIST.has(captured)) continue;
      const line = body.slice(0, m.index).split('\n').length;
      const snippet = body.slice(Math.max(0, m.index - 40), Math.min(body.length, m.index + 80)).replace(/\s+/g, ' ').trim();
      violations.push({
        code: `placeholder.${name}`,
        severity,
        file: rel,
        line,
        match: m[0],
        captured,
        snippet,
      });
      if (violations.length >= 200) break;
    }
    if (violations.length >= 200) break;
  }
  if (violations.length >= 200) break;
}

const errors = violations.filter((v) => v.severity === 'error');
const warnings = violations.filter((v) => v.severity === 'warning');

const report = {
  ok: errors.length === 0,
  files_scanned: filesScanned,
  errors: errors.length,
  warnings: warnings.length,
  violations,
  dist_dir: distDir,
};

console.log(JSON.stringify(report, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
