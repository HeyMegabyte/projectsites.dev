/**
 * Entitlement resolution for organisation billing plans.
 *
 * This module maps a subscription plan (`'free'` or `'paid'`) to a concrete
 * set of feature flags and numeric limits (the {@link Entitlements} shape
 * defined in `schemas/billing`). The worker and UI call these helpers to
 * gate features such as custom-domain support, the top-bar ad, live chat,
 * and analytics.
 *
 * | Export               | Description                                         |
 * | -------------------- | --------------------------------------------------- |
 * | `getEntitlements`    | Return the full `Entitlements` object for a plan    |
 * | `requireEntitlement` | Check whether a single entitlement is enabled       |
 *
 * @example
 * ```ts
 * import { getEntitlements, requireEntitlement } from '@shared/middleware/entitlements.js';
 *
 * const ent = getEntitlements('org_abc', 'paid');
 * // => { org_id: 'org_abc', plan: 'paid', topBarHidden: true, ... }
 *
 * if (!requireEntitlement('free', 'chatEnabled')) {
 *   return new Response('Upgrade required', { status: 402 });
 * }
 * ```
 *
 * @module entitlements
 * @packageDocumentation
 */

import { ENTITLEMENTS } from '../constants/index.js';
import type { Entitlements } from '../schemas/billing.js';

/**
 * The two subscription tiers currently supported.
 *
 * - `'free'`  -- default tier; top-bar ad shown, limited domains.
 * - `'paid'`  -- full-feature tier after Stripe checkout.
 */
type Plan = 'free' | 'paid';

/**
 * Compute the full entitlements object for an organisation given its plan.
 *
 * Looks up the static entitlement definitions in {@link ENTITLEMENTS} and
 * returns a new {@link Entitlements} record annotated with the `org_id` and
 * `plan` that produced it.
 *
 * @param orgId - The Supabase organisation UUID (e.g. `'org_abc'`).
 * @param plan  - The organisation's current subscription tier.
 * @returns A fully populated {@link Entitlements} object.
 *
 * @example
 * ```ts
 * const ent = getEntitlements('org_123', 'free');
 * console.warn(ent.topBarHidden); // false
 * console.warn(ent.maxCustomDomains); // 0
 * ```
 */
export function getEntitlements(orgId: string, plan: Plan): Entitlements {
  const planEntitlements = ENTITLEMENTS[plan];
  return {
    org_id: orgId,
    plan,
    topBarHidden: planEntitlements.topBarHidden,
    maxCustomDomains: planEntitlements.maxCustomDomains,
    chatEnabled: planEntitlements.chatEnabled,
    analyticsEnabled: planEntitlements.analyticsEnabled,
  };
}

/**
 * Check whether a single boolean or numeric entitlement is truthy for a plan.
 *
 * This is a lightweight guard intended for use in request handlers and
 * middleware where you need to gate on a single feature without building the
 * full {@link Entitlements} object.
 *
 * @param plan        - The organisation's current subscription tier.
 * @param entitlement - The key to check (e.g. `'chatEnabled'`, `'topBarHidden'`).
 * @returns `true` if the entitlement value is truthy for the given plan,
 *   `false` otherwise.
 *
 * @example
 * ```ts
 * if (!requireEntitlement('free', 'analyticsEnabled')) {
 *   return c.json({ error: 'Analytics requires a paid plan' }, 402);
 * }
 * ```
 */
export function requireEntitlement(plan: Plan, entitlement: keyof typeof ENTITLEMENTS.paid): boolean {
  const planEntitlements = ENTITLEMENTS[plan];
  return !!planEntitlements[entitlement];
}
