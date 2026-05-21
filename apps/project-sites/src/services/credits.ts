/**
 * AI Credits ledger. Every AI invocation debits 1 credit (configurable).
 * Topups are inserted via Stripe webhook or the manual `topup` endpoint.
 * Spend alerts are checked after each debit and notified via Resend.
 */
import type { Env } from '../types/env.js';

export const CREDIT_BUNDLES = {
  starter: { credits: 100, price_id: 'STRIPE_PRICE_CREDITS_100', usd: 5 },
  pro: { credits: 500, price_id: 'STRIPE_PRICE_CREDITS_500', usd: 20 },
  scale: { credits: 2000, price_id: 'STRIPE_PRICE_CREDITS_2000', usd: 70 },
} as const;
export type BundleKey = keyof typeof CREDIT_BUNDLES;

export async function getBalance(env: Env, orgId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM ai_credits_balance WHERE org_id = ?',
  )
    .bind(orgId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

/** Atomically debit credits + insert a ledger row. Returns new balance. */
export async function debitCredits(
  env: Env,
  opts: { orgId: string; siteId?: string; amount: number; reason: string; aiLogId?: string },
): Promise<number> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_credits_balance (org_id, balance, lifetime_consumed, updated_at)
       VALUES (?, -?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         balance = balance - ?, lifetime_consumed = lifetime_consumed + ?, updated_at = datetime('now')`,
    ).bind(opts.orgId, opts.amount, opts.amount, opts.amount, opts.amount),
    env.DB.prepare(
      `INSERT INTO ai_credits_ledger (id, org_id, site_id, delta, reason, ai_log_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, opts.orgId, opts.siteId ?? null, -opts.amount, opts.reason, opts.aiLogId ?? null),
  ]);
  const fresh = await getBalance(env, opts.orgId);
  return fresh;
}

export async function topupCredits(
  env: Env,
  opts: { orgId: string; amount: number; stripeSessionId?: string; reason?: string },
): Promise<number> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ai_credits_balance (org_id, balance, lifetime_purchased, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         balance = balance + ?, lifetime_purchased = lifetime_purchased + ?, updated_at = datetime('now')`,
    ).bind(opts.orgId, opts.amount, opts.amount, opts.amount, opts.amount),
    env.DB.prepare(
      `INSERT INTO ai_credits_ledger (id, org_id, delta, reason, stripe_session_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, opts.orgId, opts.amount, opts.reason ?? 'topup', opts.stripeSessionId ?? null),
  ]);
  return getBalance(env, opts.orgId);
}

export interface SpendAlertRow {
  id: string;
  name: string;
  threshold_credits: number;
  alert_kind: string;
  notify_email: string;
  enabled: number;
  last_triggered_at: string | null;
}

/** Check alerts after a debit; fire-and-forget Resend if any trip. */
export async function maybeFireAlerts(
  env: Env,
  orgId: string,
  newBalance: number,
): Promise<void> {
  const alerts = await env.DB.prepare(
    `SELECT id, name, threshold_credits, alert_kind, notify_email, enabled, last_triggered_at
     FROM spend_alerts WHERE org_id = ? AND enabled = 1`,
  )
    .bind(orgId)
    .all<SpendAlertRow>();
  if (!alerts.results?.length) return;
  for (const a of alerts.results) {
    let shouldFire = false;
    if (a.alert_kind === 'balance_low' && newBalance <= a.threshold_credits) shouldFire = true;
    if (a.alert_kind === 'daily_burn') {
      const today = new Date().toISOString().slice(0, 10);
      const row = await env.DB.prepare(
        `SELECT COALESCE(SUM(-delta), 0) AS spent FROM ai_credits_ledger
         WHERE org_id = ? AND delta < 0 AND created_at >= ?`,
      )
        .bind(orgId, `${today}T00:00:00.000Z`)
        .first<{ spent: number }>();
      if ((row?.spent ?? 0) >= a.threshold_credits) shouldFire = true;
    }
    if (!shouldFire) continue;
    // Throttle to once per 12h.
    if (a.last_triggered_at) {
      const lastMs = Date.parse(a.last_triggered_at);
      if (Date.now() - lastMs < 12 * 60 * 60 * 1000) continue;
    }
    await env.DB.prepare(
      `UPDATE spend_alerts SET last_triggered_at = datetime('now') WHERE id = ?`,
    )
      .bind(a.id)
      .run();
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'alerts@projectsites.dev',
          to: [a.notify_email],
          subject: `Project Sites spend alert: ${a.name}`,
          text: `Alert "${a.name}" triggered.\nKind: ${a.alert_kind}\nThreshold: ${a.threshold_credits}\nCurrent balance: ${newBalance}\n\nManage alerts: https://projectsites.dev/admin/billing`,
        }),
      }).catch(() => {});
    }
  }
}
