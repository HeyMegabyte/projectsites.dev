#!/usr/bin/env node
// Monitor LMG build to terminal status. Does NOT trigger anything.
// Use after a reset has already been issued.
//
// Required env: CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL, CLOUDFLARE_ACCOUNT_ID

import { env, exit } from 'node:process';

const SITE_ID = 'ec6f7f31-eab1-4c12-914e-aec502bab50a';
const SLUG = 'lonemountainglobal';
const D1_DB_ID = 'ea3e839a-c641-4861-ae30-dfc63bff8032';
const ZONE_ID = '75a6f8d5e441cd7124552976ba894f83';
const POLL_MS = 60_000;
const MAX_POLLS = 50;
const TERMINAL = new Set(['published', 'error', 'archived']);

const CF_KEY = env.CLOUDFLARE_API_KEY;
const CF_EMAIL = env.CLOUDFLARE_EMAIL;
const CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID ?? '84fa0d1b16ff8086dd958c468ce7fd59';
if (!CF_KEY || !CF_EMAIL) { console.error('missing CF creds'); exit(2); }

const start = Date.now();
let last = '';
let lastUpd = '';
let lastAuditCount = 0;

for (let i = 0; i < MAX_POLLS; i++) {
  const rows = await d1(`SELECT status, updated_at FROM sites WHERE id=?`, [SITE_ID]);
  const row = rows[0];
  if (!row) { log(`poll ${i + 1}: site missing`); await sleep(POLL_MS); continue; }
  const elapsed = ((Date.now() - start) / 60_000).toFixed(1);
  if (row.status !== last || row.updated_at !== lastUpd) {
    log(`[${elapsed}m] status=${row.status} updated=${row.updated_at}`);
    last = row.status;
    lastUpd = row.updated_at;
    // Show new audit entries since last check
    await tailAudit(SITE_ID, lastAuditCount, (n) => { lastAuditCount = n; });
  }
  if (TERMINAL.has(row.status)) {
    const cost = await sumCost(SITE_ID);
    log(`TERMINAL: ${row.status} cost=$${(cost / 100).toFixed(2)} elapsed=${elapsed}m`);
    if (row.status === 'published') {
      log(`live: https://${SLUG}.projectsites.dev`);
      await purge(SLUG);
    } else {
      await dumpErrors(SITE_ID);
    }
    exit(row.status === 'published' ? 0 : 1);
  }
  await sleep(POLL_MS);
}
log(`TIMEOUT after ${MAX_POLLS} polls`);
await dumpErrors(SITE_ID);
exit(1);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(m) { const t = new Date().toISOString().slice(0, 19).replace('T', ' '); console.log(`[${t}] ${m}`); }

async function d1(sql, params) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${D1_DB_ID}/query`,
    { method: 'POST', headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) },
  );
  const j = await r.json();
  if (!j.success) throw new Error(`D1: ${JSON.stringify(j.errors)}`);
  return j.result?.[0]?.results ?? [];
}

async function tailAudit(siteId, sinceCount, setCount) {
  const rows = await d1(
    `SELECT created_at, action, severity FROM audit_logs
     WHERE target_id=? AND target_type='site' AND created_at >= datetime('now','-30 minutes')
     ORDER BY created_at ASC`,
    [siteId],
  );
  for (let i = sinceCount; i < rows.length; i++) {
    const r = rows[i];
    log(`  audit: ${r.created_at} [${r.severity}] ${r.action}`);
  }
  setCount(rows.length);
}

async function sumCost(siteId) {
  const r = await d1(
    `SELECT COALESCE(SUM(cost_cents), 0) AS t FROM audit_logs WHERE target_id=? AND target_type='site' AND created_at >= datetime('now','-2 hours')`,
    [siteId],
  );
  return Number(r[0]?.t ?? 0);
}

async function dumpErrors(siteId) {
  const rows = await d1(
    `SELECT created_at, action, severity, metadata_json FROM audit_logs
     WHERE target_id=? AND target_type='site' AND severity IN ('error','warning')
     ORDER BY created_at DESC LIMIT 10`,
    [siteId],
  );
  for (const r of rows) {
    log(`error: ${r.created_at} [${r.severity}] ${r.action}`);
    if (r.metadata_json && r.metadata_json !== '{}') log(`  ${String(r.metadata_json).slice(0, 220)}`);
  }
}

async function purge(slug) {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [`https://${slug}.projectsites.dev/`, `https://${slug}.projectsites.dev/index.html`] }),
    });
    const j = await r.json();
    log(`purge: ${j.success ? 'ok' : 'fail'}`);
  } catch (e) { log(`purge skipped: ${e.message}`); }
}
