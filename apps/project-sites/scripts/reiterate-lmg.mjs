#!/usr/bin/env node
// Rapid-iteration loop for lonemountainglobal.projectsites.dev.
// Mints session → POST reset → polls D1 → reports terminal status + URL + cost + elapsed.
//
// Usage:
//   node scripts/reiterate-lmg.mjs                         # free tier, no extra context
//   node scripts/reiterate-lmg.mjs --tier=plus             # premium media
//   node scripts/reiterate-lmg.mjs --notes="emphasize..."  # extra directive
//
// Required env: CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL, CLOUDFLARE_ACCOUNT_ID
//
// Failed-pipeline-protocol compliant: posts to direct worker URL (bypasses Bot Fight),
// polls every 60s with 35min cap, never blindly re-queues.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { argv, env, exit } from 'node:process';

const SITE_ID = 'ec6f7f31-eab1-4c12-914e-aec502bab50a';
const SLUG = 'lonemountainglobal';
const USER_ID = 'user-brian-001';
const ORG_ID = 'org-brian-001';
const D1_DB_ID = 'ea3e839a-c641-4861-ae30-dfc63bff8032';
const WORKER_URL = 'https://project-sites.manhattan.workers.dev';
const POLL_INTERVAL_MS = 60_000;
const MAX_POLLS = 35;
const TERMINAL_STATES = new Set(['published', 'error', 'archived']);

const args = parseArgs(argv.slice(2));
const TIER = args.tier ?? 'free';
const NOTES = args.notes ?? '';
const DIRECTIVE_VERSION = Number(args['directive-version'] ?? 0);
if (!['free', 'standard', 'plus', 'premium'].includes(TIER)) {
  console.error(`Invalid --tier=${TIER}. Use: free | standard | plus | premium`);
  exit(2);
}

const CF_API_KEY = env.CLOUDFLARE_API_KEY;
const CF_EMAIL = env.CLOUDFLARE_EMAIL;
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID ?? '84fa0d1b16ff8086dd958c468ce7fd59';
if (!CF_API_KEY || !CF_EMAIL) {
  console.error('Missing CLOUDFLARE_API_KEY or CLOUDFLARE_EMAIL env vars.');
  console.error('Source from chezmoi or .env.local before running.');
  exit(2);
}

const startedAt = Date.now();
log(`reiterate-lmg start: tier=${TIER} notes=${NOTES.length}c version=${DIRECTIVE_VERSION}`);

// 1. Mint a 30-day session
const token = randomBytes(32).toString('hex');
const tokenHash = sha256Hex(token);
const sessionId = randomUUID();
const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const nowIso = new Date().toISOString();

await d1Exec(
  `INSERT INTO sessions (id, user_id, token_hash, device_info, ip_address, expires_at, last_active_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [sessionId, USER_ID, tokenHash, 'reiterate-lmg.mjs', null, expiresAt, nowIso, nowIso, nowIso],
);
log(`session minted: ${sessionId.slice(0, 8)}…`);

// 2. POST reset to direct worker URL (bypasses Bot Fight)
const resetBody = {
  budget_tier: TIER,
  directive_version: DIRECTIVE_VERSION,
  ...(NOTES ? { additional_context: NOTES } : {}),
  expert_notes: 'Brand fidelity gates: Poppins+Hind fonts, mountain-background-splash hero, light theme polished ≥7/10, dark burgundy logo. Preserve source design.',
};

const resetRes = await fetch(`${WORKER_URL}/api/sites/${SITE_ID}/reset`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(resetBody),
});
const resetText = await resetRes.text();
if (!resetRes.ok) {
  console.error(`reset failed: HTTP ${resetRes.status}`);
  console.error(resetText.slice(0, 1000));
  exit(1);
}
const resetJson = safeJson(resetText) ?? {};
log(`reset accepted: status=${resetJson.status ?? '?'} workflow=${resetJson.workflow_instance_id ?? resetJson.workflow_id ?? '?'}`);

// 3. Poll D1 every 60s up to 35min
let lastStatus = '';
let lastUpdatedAt = '';
for (let i = 0; i < MAX_POLLS; i++) {
  await sleep(POLL_INTERVAL_MS);
  const rows = await d1Query(
    `SELECT status, updated_at FROM sites WHERE id=?`,
    [SITE_ID],
  );
  if (!rows[0]) {
    log(`poll ${i + 1}/${MAX_POLLS}: site row missing!`);
    continue;
  }
  const { status, updated_at } = rows[0];
  if (status !== lastStatus || updated_at !== lastUpdatedAt) {
    const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
    log(`poll ${i + 1}/${MAX_POLLS} [${elapsedMin}m]: status=${status} updated=${updated_at}`);
    lastStatus = status;
    lastUpdatedAt = updated_at;
  }
  if (TERMINAL_STATES.has(status)) {
    const cost = await sumCostCents(SITE_ID);
    const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
    log(`TERMINAL: status=${status} cost=$${(cost / 100).toFixed(2)} elapsed=${elapsedMin}m`);
    if (status === 'published') {
      log(`live: https://${SLUG}.projectsites.dev`);
      await invalidatePurge(SLUG);
    } else {
      log(`failure mode: ${status}. See audit_logs for diagnosis.`);
      await dumpRecentErrors(SITE_ID);
    }
    exit(status === 'published' ? 0 : 1);
  }
}
log(`TIMEOUT: ${MAX_POLLS} polls × ${POLL_INTERVAL_MS / 1000}s exceeded. Last status=${lastStatus}.`);
await dumpRecentErrors(SITE_ID);
exit(1);

// ---------------- helpers ----------------

function parseArgs(args) {
  const out = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

async function d1Call(sql, params) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Auth-Email': CF_EMAIL,
      'X-Auth-Key': CF_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`D1 call failed: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result?.[0]?.results ?? [];
}

async function d1Query(sql, params) {
  return d1Call(sql, params);
}

async function d1Exec(sql, params) {
  return d1Call(sql, params);
}

async function sumCostCents(siteId) {
  const rows = await d1Query(
    `SELECT COALESCE(SUM(cost_cents), 0) AS total FROM audit_logs WHERE target_id=? AND target_type='site' AND created_at >= datetime('now','-1 hour')`,
    [siteId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function dumpRecentErrors(siteId) {
  const rows = await d1Query(
    `SELECT created_at, action, severity, metadata_json FROM audit_logs
     WHERE target_id=? AND target_type='site' AND severity IN ('error','warning')
     ORDER BY created_at DESC LIMIT 10`,
    [siteId],
  );
  for (const r of rows) {
    log(`audit: ${r.created_at} [${r.severity}] ${r.action}`);
    if (r.metadata_json && r.metadata_json !== '{}') {
      log(`       ${String(r.metadata_json).slice(0, 200)}`);
    }
  }
}

async function invalidatePurge(slug) {
  // Best-effort cache purge; failure is non-fatal.
  try {
    const zoneId = '75a6f8d5e441cd7124552976ba894f83';
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'X-Auth-Email': CF_EMAIL,
          'X-Auth-Key': CF_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: [`https://${slug}.projectsites.dev/`, `https://${slug}.projectsites.dev/index.html`],
        }),
      },
    );
    const json = await res.json();
    log(`cache purge: ${json.success ? 'ok' : 'FAILED'}`);
  } catch (e) {
    log(`cache purge skipped: ${e.message}`);
  }
}
