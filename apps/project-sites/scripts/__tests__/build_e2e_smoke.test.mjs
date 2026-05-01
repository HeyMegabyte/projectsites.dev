// E2E build smoke TDD — runs the EXACT path that production runs (Claude Code →
// optional npm build → upload-to-r2.mjs → R2 GET) in <60s, against a real
// projectsites-container:smoke image. Acts as the regression budget for the
// whole pipeline.
//
//  Cost: 1 small Claude call (~$0.01) + a handful of R2 PUTs. Free tier safe.
//
//  Skips automatically if creds aren't present (CI/offline).
//
// Run: node --test scripts/__tests__/build_e2e_smoke.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = '/Users/apple/emdash-projects/worktrees/rare-chefs-film-8op';
const ENV_PATH = join(REPO_ROOT, '.env.local');

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const ENV = loadEnv();
const HAS_CREDS = Boolean(
  ENV.ANTHROPIC_API_KEY && ENV.CLOUDFLARE_API_KEY && ENV.CLOUDFLARE_EMAIL,
);
const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const BUCKET = 'project-sites';

const IMAGE = process.env.SMOKE_IMAGE || 'projectsites-container:smoke';
const NAME = `ps-build-e2e-${Date.now()}`;
const PORT = 18181 + Math.floor(Math.random() * 100);

let container;

function dockerLogs() {
  try { return execSync(`docker logs ${NAME} 2>&1`, { encoding: 'utf-8' }); }
  catch { return ''; }
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`container never became healthy: ${dockerLogs().slice(-500)}`);
}

before(async () => {
  if (!HAS_CREDS) return;
  container = spawn(
    'docker',
    ['run', '--rm', '--name', NAME, '-p', `${PORT}:8080`, IMAGE,
     'node', '/home/cuser/container-server.mjs'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForHealth();
});

after(() => {
  try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch {}
});

test('full build path completes in <60s and lands in R2', async (t) => {
  if (!HAS_CREDS) {
    t.skip('Missing ANTHROPIC_API_KEY / CLOUDFLARE_API_KEY / CLOUDFLARE_EMAIL — skipping');
    return;
  }

  const slug = `tdd-smoke-${Date.now()}`;
  const version = `tdd-v${Date.now()}`;
  const expectedKey = `sites/${slug}/${version}/hello.txt`;
  const expectedBody = 'Hello from TDD smoke';

  const t0 = Date.now();

  // Kick off the build.
  const startRes = await fetch(`http://localhost:${PORT}/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      skipBuild: true,
      timeoutMin: 5,
      _anthropicKey: ENV.ANTHROPIC_API_KEY,
      envVars: {
        CF_ACCOUNT_ID: ACCOUNT_ID,
        R2_BUCKET_NAME: BUCKET,
        SITE_SLUG: slug,
        SITE_VERSION: version,
        CLOUDFLARE_API_KEY: ENV.CLOUDFLARE_API_KEY,
        CLOUDFLARE_EMAIL: ENV.CLOUDFLARE_EMAIL,
      },
      prompt: `Create exactly one file named hello.txt in the current working directory whose ONLY content is: ${expectedBody}\nDo not create any other files. Do not run any build steps. Exit immediately after writing the file.`,
    }),
  });
  const { jobId } = await startRes.json();
  assert.ok(jobId, 'jobId returned');

  // Poll until terminal or budget exhausted.
  const budget = 60_000;
  let final;
  while (Date.now() - t0 < budget) {
    await sleep(1000);
    const sres = await fetch(`http://localhost:${PORT}/status?jobId=${jobId}`);
    final = await sres.json();
    if (final.status === 'complete' || final.status === 'error') break;
  }

  const elapsedMs = Date.now() - t0;
  assert.equal(final.status, 'complete',
    `expected complete, got ${final && final.status} step=${final && final.step} err=${final && final.error}`);
  assert.ok(elapsedMs < budget,
    `pipeline took ${elapsedMs}ms — over the ${budget}ms budget`);
  assert.ok(final.uploadResult && final.uploadResult.uploaded > 0,
    `upload result: ${JSON.stringify(final.uploadResult)}`);

  // Verify R2 actually has the file via the CF REST API.
  const r2Res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(expectedKey)}`,
    { headers: { 'X-Auth-Email': ENV.CLOUDFLARE_EMAIL, 'X-Auth-Key': ENV.CLOUDFLARE_API_KEY } },
  );
  assert.equal(r2Res.status, 200, `R2 GET should be 200, got ${r2Res.status}`);
  const body = await r2Res.text();
  assert.ok(body.includes(expectedBody), `R2 body should contain "${expectedBody}", got: ${body.slice(0, 200)}`);

  console.warn(`[smoke] OK in ${elapsedMs}ms — R2 key ${expectedKey}`);
});
