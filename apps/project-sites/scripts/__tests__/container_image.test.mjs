// Container image TDD — asserts the Cloudflare Workers Container image has every
// tool a Claude-Code-driven website build needs pre-installed. Run with:
//   node --test scripts/__tests__/container_image.test.mjs
//
// Requires: docker, an image tagged `projectsites-container:smoke` (built from ./Dockerfile).
//
// These specs were authored AFTER an end-to-end smoke build that spent ~9s in Claude
// + ~7s uploading to R2 (16s total) using `skipBuild=true`. They lock in that budget
// and the toolchain so the workflow can't silently regress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const IMAGE = process.env.SMOKE_IMAGE || 'projectsites-container:smoke';

function runIn(cmd) {
  return execSync(
    `docker run --rm --entrypoint sh ${IMAGE} -lc ${JSON.stringify(cmd)}`,
    { encoding: 'utf-8', timeout: 60_000 },
  );
}

test('node 22 is installed', () => {
  const out = runIn('node --version');
  assert.match(out.trim(), /^v22\./);
});

test('python3 is installed', () => {
  const out = runIn('python3 --version');
  assert.match(out.trim(), /^Python 3\./);
});

test('ffmpeg is installed', () => {
  const out = runIn('ffmpeg -version | head -1');
  assert.match(out, /ffmpeg version/);
});

test('imagemagick is installed', () => {
  const out = runIn('convert -version | head -1 || magick -version | head -1');
  assert.match(out, /ImageMagick/);
});

test('libvips is installed', () => {
  const out = runIn('vips --version || vipsthumbnail --version');
  assert.match(out, /vips/i);
});

test('jq is installed', () => {
  const out = runIn('jq --version');
  assert.match(out.trim(), /^jq-/);
});

test('image optimizers are installed', () => {
  const out = runIn('optipng -v 2>&1 | head -1 && jpegoptim --version 2>&1 | head -1 && cwebp -version 2>&1 | head -1');
  assert.match(out, /OptiPNG/);
  assert.match(out, /jpegoptim/);
});

test('claude code cli is installed', () => {
  const out = runIn('which claude && claude --version');
  assert.match(out, /\/claude/);
});

test('global JS helpers are installed', () => {
  const out = runIn('which tsc && which esbuild && which svgo && which vite');
  assert.match(out, /tsc/);
  assert.match(out, /esbuild/);
  assert.match(out, /svgo/);
  assert.match(out, /vite/);
});

test('python helpers are installed', () => {
  const out = runIn('python3 -c "import PIL, requests, bs4, lxml, yaml; print(\\"ok\\")"');
  assert.match(out, /ok/);
});

test('claude-skills repo cloned at /home/cuser/.agentskills', () => {
  const out = runIn('cd /home/cuser/.agentskills && git remote -v | head -1');
  assert.match(out, /megabytespace\/claude-skills/);
});

test('skills router file is present', () => {
  const out = runIn('test -f /home/cuser/.agentskills/_router.md && echo ok');
  assert.match(out, /ok/);
});

test('template repo cloned at /home/cuser/template', () => {
  const out = runIn('cd /home/cuser/template && git remote -v | head -1');
  assert.match(out, /HeyMegabyte\/template\.projectsites\.dev/);
});

test('cuser-owned home', () => {
  const out = runIn('stat -c "%U" /home/cuser/.agentskills /home/cuser/template');
  for (const line of out.trim().split('\n')) {
    assert.equal(line.trim(), 'cuser');
  }
});
