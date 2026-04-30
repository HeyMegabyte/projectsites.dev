#!/usr/bin/env node
// Validator runner — invoked by validator-fixer subagent inside the container.
// Walks a build dir, hands every file to validateBuild() from
// build_validators.ts, prints the report as JSON. Spawns tsx so we can import
// the .ts source directly without a compile step.
//
// Usage:  node scripts/run-validators.mjs <build_dir>     (default: dist)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
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

const root = process.argv[2] ?? 'dist';
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(JSON.stringify({ ok: false, error: `not a directory: ${root}` }));
  process.exit(2);
}

const files = [];
for (const abs of walk(root)) {
  const rel = relative(root, abs).replaceAll('\\', '/');
  const { size } = statSync(abs);
  let text;
  if (isText(rel) && size < 4_000_000) {
    try { text = readFileSync(abs, 'utf8'); } catch { /* binary */ }
  }
  files.push({ path: rel, size, text });
}

// Locate build_validators.ts. Container places it at /home/cuser/. Repo root has
// it at apps/project-sites/src/services/. Pick the first match.
const candidates = [
  '/home/cuser/build_validators.ts',
  join(here, '..', 'src', 'services', 'build_validators.ts'),
  join(here, '..', '..', 'apps', 'project-sites', 'src', 'services', 'build_validators.ts'),
];
const validatorPath = candidates.find((p) => existsSync(p));
if (!validatorPath) {
  console.error(JSON.stringify({ ok: false, error: 'build_validators.ts not found', candidates }));
  process.exit(2);
}

// Spawn tsx with an inline runner. Pass files via stdin to avoid argv length limits.
const runner = `
  import { validateBuild } from ${JSON.stringify(validatorPath)};
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const files = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const report = validateBuild(files);
    const blockers = report.errors.length;
    const warnings = report.warnings.length;
    console.log(JSON.stringify({
      ok: blockers === 0,
      blockers,
      warnings,
      violations: [...report.errors, ...report.warnings, ...report.infos],
      summary: report.summary,
    }, null, 2));
    process.exit(blockers === 0 ? 0 : 1);
  });
`;

const result = spawnSync('tsx', ['-e', runner], {
  input: JSON.stringify(files),
  stdio: ['pipe', 'inherit', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});

process.exit(result.status ?? 1);
