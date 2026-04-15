/**
 * Build limits — free users get 3 builds, paid users get 50.
 * Tracked by counting non-deleted sites per org.
 */
import { dbQuery, dbQueryOne } from './db.js';

const FREE_LIMIT = 3;
const PAID_LIMIT = 50;

// Org IDs with unlimited builds
const UNLIMITED_ORGS = new Set<string>();

export async function checkBuildLimit(
  db: D1Database,
  orgId: string,
  plan: string | null,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  // Check if this org has unlimited builds
  if (UNLIMITED_ORGS.has(orgId)) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  // Check if the org owner's email is in the unlimited list
  const owner = await dbQueryOne<{ email: string }>(
    db,
    `SELECT u.email FROM users u JOIN memberships m ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1`,
    [orgId],
  );
  if (owner?.email === 'brian@megabyte.space') {
    UNLIMITED_ORGS.add(orgId);
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  const limit = plan === 'paid' ? PAID_LIMIT : FREE_LIMIT;

  const result = await dbQuery<{ count: number }>(
    db,
    'SELECT COUNT(*) as count FROM sites WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  const used = result.data[0]?.count ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
  };
}
