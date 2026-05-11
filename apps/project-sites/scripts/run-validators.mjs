#!/usr/bin/env node
// Validator runner — invoked by validator-fixer subagent inside the container.
// Walks a build dir, hands every file to validateBuild() from
// build_validators.ts, prints a unified JSON report that also includes the
// bonus skill-15 validators (NAP consistency, photo authenticity) when
// _research.json is on disk.
//
// Usage:  node scripts/run-validators.mjs [build_dir_or_dist]
//   build_dir   = parent dir containing _research.json + dist/
//   dist        = direct path to the built static-site output
// Both layouts are auto-detected.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav', 'pdf', 'zip'];
const isText = (p) => !BIN.includes(p.split('.').pop()?.toLowerCase() ?? '');
const here = dirname(fileURLToPath(import.meta.url));

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const argDir = resolve(process.argv[2] ?? 'dist');
if (!existsSync(argDir) || !statSync(argDir).isDirectory()) {
  console.error(JSON.stringify({ ok: false, error: `not a directory: ${argDir}` }));
  process.exit(2);
}

// Auto-detect whether the user passed the build root (has dist/) or the dist itself.
const hasDistSub = existsSync(join(argDir, 'dist')) && statSync(join(argDir, 'dist')).isDirectory();
const distDir = hasDistSub ? join(argDir, 'dist') : argDir;
const buildRoot = hasDistSub ? argDir : dirname(argDir);

const files = [];
for (const abs of walk(distDir)) {
  const rel = relative(distDir, abs).replaceAll('\\', '/');
  const { size } = statSync(abs);
  let text;
  if (isText(rel) && size < 4_000_000) {
    try { text = readFileSync(abs, 'utf8'); } catch { /* binary */ }
  }
  files.push({ path: rel, size, text });
}

// Locate build_validators.ts.
const validatorCandidates = [
  '/home/cuser/build_validators.ts',
  join(here, '..', 'src', 'services', 'build_validators.ts'),
  join(here, '..', '..', 'apps', 'project-sites', 'src', 'services', 'build_validators.ts'),
];
const validatorPath = validatorCandidates.find((p) => existsSync(p));
if (!validatorPath) {
  console.error(JSON.stringify({ ok: false, error: 'build_validators.ts not found', candidates: validatorCandidates }));
  process.exit(2);
}

// 1) Run the core build_validators.ts via tsx + stdin pipe.
const runner = `
  import { validateBuild } from ${JSON.stringify(validatorPath)};
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const files = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const report = validateBuild(files);
    process.stdout.write(JSON.stringify({
      errors: report.errors,
      warnings: report.warnings,
      infos: report.infos,
      summary: report.summary,
    }));
  });
`;
const core = spawnSync('tsx', ['-e', runner], {
  input: JSON.stringify(files),
  stdio: ['pipe', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});
let coreReport = { errors: [], warnings: [], infos: [], summary: { error: 'core validator did not emit output' } };
if (core.status === 0 && core.stdout) {
  try { coreReport = JSON.parse(core.stdout.toString('utf8')); } catch (e) {
    coreReport = { errors: [], warnings: [], infos: [], summary: { error: `core validator JSON parse: ${e.message}` } };
  }
}

// 2) Run the bonus validators (skill 15 + doctrine) when _research.json is on disk.
//    NAP gate: enforced only on local-business mode (the script self-skips otherwise).
//    Photo authenticity: enforced only when team/about/gallery pages exist (also self-skips).
//    Mission-doctrine + delight-moments: SOFT validators, exit 0 with warnings only —
//    completeness-checker promotes them to a blocker on the final pass.
const HARD_BONUS = [
  '/home/cuser/.agentskills/15-site-generation/validate-nap-consistency.mjs',
  '/home/cuser/.agentskills/15-site-generation/validate-photo-authenticity.mjs',
  resolve(process.env.HOME ?? '', '.agentskills/15-site-generation/validate-nap-consistency.mjs'),
  resolve(process.env.HOME ?? '', '.agentskills/15-site-generation/validate-photo-authenticity.mjs'),
  // Placeholder substitution gate — catches {BUSINESS_NAME}/{{BUSINESS}}/lorem-ipsum leakage
  // that produced the 2026-05-11 09:06 LMG nuke (13 files of raw template shell).
  join(here, 'validate-no-placeholders.mjs'),
];
const SOFT_BONUS = [
  join(here, 'validate-mission-doctrine.mjs'),
  join(here, 'validate-delight-moments.mjs'),
];

const bonusRuns = [];
const hasResearch = existsSync(join(buildRoot, '_research.json'));

function runBonus(path, soft) {
  const name = path.split('/').pop().replace('.mjs', '');
  const r = spawnSync('node', [path, buildRoot], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let parsedWarnings = [];
  try {
    const parsed = JSON.parse(r.stdout || '{}');
    if (Array.isArray(parsed.warnings)) parsedWarnings = parsed.warnings;
  } catch { /* not JSON — fall back to tails */ }
  bonusRuns.push({
    validator: name,
    soft,
    exit_code: r.status ?? -1,
    ok: r.status === 0,
    warnings: parsedWarnings,
    stdout_tail: (r.stdout || '').split('\n').slice(-20).join('\n'),
    stderr_tail: (r.stderr || '').split('\n').slice(-20).join('\n'),
  });
}

if (hasResearch) {
  for (const v of HARD_BONUS) {
    if (existsSync(v)) runBonus(v, false);
  }
}
// Soft validators always run when their scripts exist — they self-skip when
// _iteration_log.json is missing.
for (const v of SOFT_BONUS) {
  if (existsSync(v)) runBonus(v, true);
}

// Hard-bonus failures (exit !== 0) become blockers for validator-fixer.
const bonusBlockers = bonusRuns
  .filter((b) => !b.soft && !b.ok)
  .map((b) => ({
    code: b.validator === 'validate-nap-consistency' ? 'nap.inconsistent' : 'photo.authenticity_unverified',
    severity: 'error',
    source: b.validator,
    message: b.stderr_tail || b.stdout_tail || `${b.validator} exited ${b.exit_code}`,
  }));

// Soft-bonus warnings flow into infos[] — completeness-checker reads them at
// the final gate. They never block validator-fixer convergence.
const softInfos = bonusRuns
  .filter((b) => b.soft)
  .flatMap((b) => b.warnings.map((w) => ({ ...w, source: b.validator })));

const errors = [...coreReport.errors, ...bonusBlockers];
const warnings = coreReport.warnings;
const infos = [...coreReport.infos, ...softInfos];
const blockers = errors.length;

console.log(JSON.stringify({
  ok: blockers === 0,
  blockers,
  warnings: warnings.length,
  violations: [...errors, ...warnings, ...infos],
  bonus: bonusRuns,
  summary: coreReport.summary,
  build_root: buildRoot,
  dist_dir: distDir,
}, null, 2));

process.exit(blockers === 0 ? 0 : 1);
