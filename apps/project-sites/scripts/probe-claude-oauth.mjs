#!/usr/bin/env node
// One-shot probe: confirms the local Claude Code OAuth access token is accepted
// by https://api.anthropic.com/v1/messages with the documented oauth beta header.
// Reads the token from macOS Keychain (Claude Code-credentials) — the same file
// `claude` itself reads. No token is printed; only the HTTP status + first body chars.
import { execFileSync } from 'node:child_process';

const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'])
  .toString()
  .trim();
const oauth = JSON.parse(raw).claudeAiOauth;
if (!oauth?.accessToken) {
  console.error('No claudeAiOauth.accessToken in keychain. Run `claude /login` first.');
  process.exit(2);
}

const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${oauth.accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ok' }],
  }),
});
const text = await r.text();
console.log('HTTP', r.status);
console.log(text.slice(0, 600));
process.exit(r.ok ? 0 : 1);
