#!/usr/bin/env node
// Hard-gate verifier: confirms Angular bundle is live at the given URL.
// Fails non-zero if `main-<hash>.js` is missing from the HTML, which means
// R2 still holds the legacy static SPA instead of the Angular shell.
//
// Usage: node scripts/verify-deploy.mjs https://projectsites.dev

import { exit } from 'node:process';

const url = process.argv[2];
if (!url) {
  console.error('usage: verify-deploy.mjs <url>');
  exit(2);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const probe = async (path) => {
  const target = new URL(path, url).toString();
  const res = await fetch(target, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const body = await res.text();
  return { status: res.status, body, target };
};

const checks = [];

try {
  const root = await probe('/');
  const hasMain = /main-[A-Za-z0-9]+\.js/.test(root.body);
  const hasPolyfills = /polyfills-[A-Za-z0-9]+\.js/.test(root.body);
  const hasStyles = /styles-[A-Za-z0-9]+\.css/.test(root.body);
  const hasAppRoot = /<app-root/.test(root.body);
  checks.push({
    name: 'homepage',
    target: root.target,
    status: root.status,
    hasMain,
    hasPolyfills,
    hasStyles,
    hasAppRoot,
    ok: root.status === 200 && hasMain && hasPolyfills && hasStyles && hasAppRoot,
  });

  const admin = await probe('/admin/dashboard');
  const adminHasMain = /main-[A-Za-z0-9]+\.js/.test(admin.body);
  const adminHasAppRoot = /<app-root/.test(admin.body);
  checks.push({
    name: 'admin-shell',
    target: admin.target,
    status: admin.status,
    hasMain: adminHasMain,
    hasAppRoot: adminHasAppRoot,
    ok: admin.status === 200 && adminHasMain && adminHasAppRoot,
  });
} catch (err) {
  console.error('verify-deploy: fetch failed:', err.message);
  exit(1);
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  const tag = c.ok ? 'PASS' : 'FAIL';
  console.warn(`[${tag}] ${c.name} ${c.target} -> ${c.status}`);
  for (const [k, v] of Object.entries(c)) {
    if (['name', 'target', 'status', 'ok'].includes(k)) continue;
    console.warn(`       ${k}: ${v}`);
  }
}

if (failed.length > 0) {
  console.error(`\nverify-deploy: ${failed.length} check(s) failed — Angular bundle not live.`);
  exit(1);
}

console.warn('\nverify-deploy: all checks passed — Angular bundle confirmed live.');
