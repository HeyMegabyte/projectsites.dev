/**
 * @module services/build_limits
 *
 * @description
 * Enforces per-org build quotas for the AI site-generation workflow. Free
 * plans get 3 lifetime builds; paid plans get 50; explicitly-allowlisted
 * org owners (currently `brian@megabyte.space`) are uncapped. Counted as
 * `COUNT(*)` over `sites WHERE org_id=? AND deleted_at IS NULL` — soft-
 * deleted sites do **not** count against the quota, so a user can free
 * capacity by archiving low-value sites without database GC.
 *
 * Lifecycle:
 * - Called from `routes/api.ts` at the entry to `POST /api/sites` and
 *   `POST /api/sites/create-from-search` before workflow dispatch.
 * - Caller surfaces `remaining` to the UI for "X of N builds used" copy.
 * - Caller throws `AppError('PAYMENT_REQUIRED')` when `allowed=false` and
 *   the marketing SPA renders the upgrade prompt.
 *
 * Quota semantics are intentionally generous (no rate limit, only lifetime
 * count) because each build costs $5–$15 of API spend — the real abuse
 * vector is unlimited rebuilds, not burst traffic.
 *
 * @example
 * ```ts
 * const { allowed, remaining } = await checkBuildLimit(env.DB, orgId, sub.plan);
 * if (!allowed) throw new AppError('PAYMENT_REQUIRED', 'Build quota exhausted');
 * ```
 *
 * @see {@link module:services/billing}
 * @see {@link module:routes/api}
 */
import { dbQuery, dbQueryOne } from './db.js';

/** Lifetime builds available on the free tier. */
const FREE_LIMIT = 3;

/** Lifetime builds available on the paid tier. */
const PAID_LIMIT = 50;

/**
 * In-process memoization cache of orgs verified as uncapped via the
 * owner-email allowlist. Reset on every Worker isolate restart, which is
 * fine — re-verification is one D1 read per cold path.
 */
const UNLIMITED_ORGS = new Set<string>();

/**
 * Resolve a build-quota decision for the given org.
 *
 * @param db - D1 binding from the request context.
 * @param orgId - UUID v4 of the tenant org being charged for the build.
 * @param plan - Plan string from the `subscriptions` table; `null` or
 *   anything other than `'paid'` falls back to the free cap.
 * @returns Decision object: `allowed` (proceed?), `used` (current count),
 *   `limit` (cap for the resolved plan; `Infinity` for allowlisted orgs),
 *   `remaining` (`max(0, limit - used)`).
 *
 * @remarks
 * Side effect: on first allowlist hit, the org id is memoized in the
 * in-process `UNLIMITED_ORGS` set. Subsequent calls within the same
 * isolate skip the membership lookup. The set is **not** persisted —
 * isolate eviction re-runs the email check, which is acceptable since
 * the allowlist is small (1 entry today).
 *
 * Performance: 2 D1 reads worst case (owner email + site count), 1 D1
 * read on warm allowlist hits. Both queries are indexed
 * (`memberships(org_id, role)` and `sites(org_id, deleted_at)`).
 *
 * @throws Never — D1 errors propagate as rejected promises and surface
 *   in `error_handler` middleware as `INTERNAL_ERROR`. Callers SHOULD
 *   `try/catch` around this to render an upgrade prompt on quota
 *   exhaustion vs. a generic error on infra failure.
 */
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
