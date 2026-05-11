// Static contract test for scripts/upload-to-r2.mjs.
//
// upload-to-r2.mjs runs inside the build container and is invoked as a
// subprocess (`node /home/cuser/upload-to-r2.mjs`), so we don't import it
// here — the script reads env at module top-level and calls main() at EOF,
// which would fire on require/import. Instead we lock in the behaviors that
// matter for the "all files reach R2" guarantee via static-text assertions.
//
// These guard against regressions of three historical bugs:
//   (a) 10MB file cap silently dropped large hero videos (raised to 50MB).
//   (b) Vite-built sites uploaded only `dist/` while `public/` extras were
//       never copied into dist (now: scan `public/` and union with dist files).
//   (c) Build-only artifacts (`_research.json`, `_assets.json`, `node_modules/`)
//       leaked into R2 (now: SKIP_DIRS + underscore filter at root only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'upload-to-r2.mjs');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf-8');

test('MAX_FILE_BYTES is 50MB (raised from 10MB to fit hero videos)', () => {
  assert.match(SOURCE, /MAX_FILE_BYTES\s*=\s*50_000_000/);
});

test('SKIP_DIRS excludes node_modules and build-only research artifacts', () => {
  // Single-source set; assert each entry individually so reorderings pass.
  for (const entry of ['node_modules', '.git', '.cache', '.vite', '.turbo', '_src', '_research', '_assets']) {
    assert.match(SOURCE, new RegExp(`'${entry.replace(/\./g, '\\.')}'`),
      `SKIP_DIRS missing entry: ${entry}`);
  }
});

test('underscore-prefixed entries are filtered only at the build root', () => {
  // base === '' guard prevents nested _src/_archive being filtered twice but
  // also lets nested files like assets/_internal.json through unchanged.
  assert.match(SOURCE, /base === ''[\s\S]*entry\.startsWith\('_'\)/);
});

test('public/ recovery scans for files Vite forgot to copy into dist/', () => {
  assert.match(SOURCE, /hasPublicDir/);
  assert.match(SOURCE, /recoveredFromPublic/);
  assert.match(SOURCE, /collectFiles\(publicDir\)/);
});

test('manifest exposes skipped + recovered_from_public for observability', () => {
  assert.match(SOURCE, /skipped:\s*\{/);
  assert.match(SOURCE, /recovered_from_public:\s*recoveredFromPublic/);
});

test('upload result JSON exposes recovered + skipped counts', () => {
  assert.match(SOURCE, /recovered_from_public:\s*recoveredFromPublic\.length/);
  assert.match(SOURCE, /skipped_large:\s*skipped\.large\.length/);
  assert.match(SOURCE, /skipped_empty:\s*skipped\.empty\.length/);
});

test('zero-byte files are skipped (not uploaded as broken assets)', () => {
  assert.match(SOURCE, /stat\.size === 0[\s\S]*skipped\.empty\.push/);
});

test('supports both CF_API_TOKEN and global X-Auth-Email/X-Auth-Key', () => {
  assert.match(SOURCE, /HAS_TOKEN_AUTH/);
  assert.match(SOURCE, /HAS_GLOBAL_KEY_AUTH/);
  assert.match(SOURCE, /X-Auth-Email/);
  assert.match(SOURCE, /X-Auth-Key/);
});
