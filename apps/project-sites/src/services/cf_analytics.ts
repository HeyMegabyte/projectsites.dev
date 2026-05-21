/**
 * Cloudflare Analytics Engine helpers.
 *
 * Writes one data point per admin visit (or any tracked event) and reads
 * aggregates back via the SQL API (https://api.cloudflare.com/client/v4/
 * accounts/:account_id/analytics_engine/sql).
 *
 * Data point layout:
 *   blobs[0] = event ('admin_visit' | 'form_submit' | 'ai_call' | …)
 *   blobs[1] = route_path (e.g. '/admin/forms')
 *   blobs[2] = site_id (or '-')
 *   blobs[3] = org_id (or '-')
 *   blobs[4] = user_agent_class ('desktop' | 'mobile' | 'tablet' | 'bot')
 *   blobs[5] = referrer host (or '-')
 *   blobs[6] = country (CF-IPCountry)
 *   doubles[0] = 1 (count) — useful so SUM() gives event count
 *   doubles[1] = latency_ms (when relevant; otherwise 0)
 *   indexes[0] = sampling key (org_id) — Analytics Engine samples within an index
 */
import type { Env } from '../types/env.js';

export function classifyUserAgent(ua: string | null): 'desktop' | 'mobile' | 'tablet' | 'bot' {
  if (!ua) return 'desktop';
  const u = ua.toLowerCase();
  if (/bot|crawler|spider|crawling|headlesschrome/i.test(u)) return 'bot';
  if (/ipad|tablet/.test(u)) return 'tablet';
  if (/iphone|android|mobile/.test(u)) return 'mobile';
  return 'desktop';
}

export function recordEvent(
  env: Env,
  ev: {
    event: 'admin_visit' | 'form_submit' | 'ai_call' | 'site_serve' | 'mcp_call' | 'login' | 'signup';
    routePath?: string;
    siteId?: string | null;
    orgId?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
    country?: string | null;
    latencyMs?: number;
  },
): void {
  if (!env.ANALYTICS) return;
  env.ANALYTICS.writeDataPoint({
    blobs: [
      ev.event,
      ev.routePath ?? '-',
      ev.siteId ?? '-',
      ev.orgId ?? '-',
      classifyUserAgent(ev.userAgent ?? null),
      ev.referrer ? safeHost(ev.referrer) : '-',
      ev.country ?? '-',
    ],
    doubles: [1, ev.latencyMs ?? 0],
    indexes: [ev.orgId ?? 'anonymous'],
  });
}

function safeHost(referrer: string): string {
  try { return new URL(referrer).hostname; } catch { return '-'; }
}

interface SqlRow { [k: string]: string | number; }

/**
 * Query the Analytics Engine SQL API.
 * Returns parsed rows; cap is per CF (~1k rows). Errors throw with message.
 */
export async function querySql(env: Env, sql: string): Promise<SqlRow[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID + CF_API_TOKEN required to query Analytics Engine');
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Analytics Engine SQL ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: SqlRow[]; meta: unknown };
  return json.data ?? [];
}

export interface OverviewSeries {
  total_visits: number;
  unique_orgs: number;
  visits_by_day: { day: string; visits: number }[];
  top_routes: { route_path: string; visits: number }[];
  ua_breakdown: { user_agent_class: string; visits: number }[];
  top_referrers: { referrer: string; visits: number }[];
  top_countries: { country: string; visits: number }[];
  last_hour_visits: number;
}

export async function loadOverview(env: Env, orgId: string): Promise<OverviewSeries> {
  const ds = 'projectsites_admin_v1';
  const orgFilter = `blob4 = '${orgId.replace(/'/g, "''")}'`;
  // Note: blob1='admin_visit' filter ensures we only count visits, not other events.
  const evFilter = `blob1 = 'admin_visit'`;
  const where30d = `WHERE ${evFilter} AND ${orgFilter} AND timestamp > NOW() - INTERVAL '30' DAY`;
  // CF Analytics Engine: blob1 was event in our writeDataPoint; double1 is count.
  const [total, byDay, byRoute, byUa, byRef, byCountry, lastHour] = await Promise.all([
    querySql(env, `SELECT SUM(_sample_interval) AS visits FROM ${ds} ${where30d}`),
    querySql(env, `SELECT toStartOfDay(timestamp) AS day, SUM(_sample_interval) AS visits FROM ${ds} ${where30d} GROUP BY day ORDER BY day ASC`),
    querySql(env, `SELECT blob2 AS route_path, SUM(_sample_interval) AS visits FROM ${ds} ${where30d} GROUP BY route_path ORDER BY visits DESC LIMIT 15`),
    querySql(env, `SELECT blob5 AS user_agent_class, SUM(_sample_interval) AS visits FROM ${ds} ${where30d} GROUP BY user_agent_class ORDER BY visits DESC`),
    querySql(env, `SELECT blob6 AS referrer, SUM(_sample_interval) AS visits FROM ${ds} ${where30d} GROUP BY referrer ORDER BY visits DESC LIMIT 15`),
    querySql(env, `SELECT blob7 AS country, SUM(_sample_interval) AS visits FROM ${ds} ${where30d} GROUP BY country ORDER BY visits DESC LIMIT 15`),
    querySql(env, `SELECT SUM(_sample_interval) AS visits FROM ${ds} WHERE ${evFilter} AND ${orgFilter} AND timestamp > NOW() - INTERVAL '1' HOUR`),
  ]);
  return {
    total_visits: Number(total?.[0]?.['visits'] ?? 0),
    unique_orgs: 0,
    visits_by_day: (byDay ?? []).map((r) => ({ day: String(r['day']), visits: Number(r['visits']) })),
    top_routes: (byRoute ?? []).map((r) => ({ route_path: String(r['route_path']), visits: Number(r['visits']) })),
    ua_breakdown: (byUa ?? []).map((r) => ({ user_agent_class: String(r['user_agent_class']), visits: Number(r['visits']) })),
    top_referrers: (byRef ?? []).map((r) => ({ referrer: String(r['referrer']), visits: Number(r['visits']) })),
    top_countries: (byCountry ?? []).map((r) => ({ country: String(r['country']), visits: Number(r['visits']) })),
    last_hour_visits: Number(lastHour?.[0]?.['visits'] ?? 0),
  };
}
