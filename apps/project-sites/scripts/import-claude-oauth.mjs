#!/usr/bin/env node
/**
 * Bootstrap: read the local Claude Code OAuth tokens from macOS Keychain and
 * push them into Cloudflare as production worker secrets.
 *
 * After running this once, the projectsites.dev build pipeline runs all
 * `claude -p` invocations under Brian's Max 20x subscription quota instead
 * of the metered API key. Re-run whenever `claude /login` rotates the
 * refresh token (rare — Anthropic's refresh tokens are long-lived).
 *
 * Usage:
 *   node scripts/import-claude-oauth.mjs                 # production (default)
 *   node scripts/import-claude-oauth.mjs --env staging   # staging
 *
 * Reads the same blob `claude` itself reads, never echoes a token.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
const env = envIdx >= 0 ? args[envIdx + 1] : 'production';

let raw;
try {
  raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'])
    .toString()
    .trim();
} catch (e) {
  console.error('Could not read "Claude Code-credentials" from macOS Keychain.');
  console.error('Run `claude /login` first to mint a subscription token.');
  process.exit(2);
}

let oauth;
try {
  oauth = JSON.parse(raw).claudeAiOauth;
} catch {
  console.error('Keychain entry is not valid JSON.');
  process.exit(2);
}

if (!oauth?.accessToken || !oauth?.refreshToken || !oauth?.expiresAt) {
  console.error('Keychain blob missing claudeAiOauth.{accessToken,refreshToken,expiresAt}.');
  process.exit(2);
}

const expiresAtMs = Number(oauth.expiresAt);
const expiresInH = ((expiresAtMs - Date.now()) / 3600000).toFixed(1);
console.warn(`Loaded OAuth tokens (expires in ~${expiresInH}h, subscription=${oauth.subscriptionType || 'unknown'}).`);
console.warn(`Pushing 3 secrets to wrangler env=${env}: CLAUDE_OAUTH_ACCESS_TOKEN, CLAUDE_OAUTH_REFRESH_TOKEN, CLAUDE_OAUTH_EXPIRES_AT`);

function putSecret(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--env', env], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`wrangler secret put ${name} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

putSecret('CLAUDE_OAUTH_ACCESS_TOKEN', oauth.accessToken);
putSecret('CLAUDE_OAUTH_REFRESH_TOKEN', oauth.refreshToken);
putSecret('CLAUDE_OAUTH_EXPIRES_AT', String(expiresAtMs));

console.warn('');
console.warn('Done. Next build will use subscription auth — no metered API credits burned.');
console.warn('Worker auto-refreshes the access token via console.anthropic.com/v1/oauth/token when it nears expiry.');
