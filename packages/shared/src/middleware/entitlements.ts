import { ENTITLEMENTS } from '../constants/index.js';
import type { Entitlements } from '../schemas/billing.js';

type Plan = 'free' | 'paid';

/**
 * Compute entitlements for an org based on its subscription plan.
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
 * Check if a specific entitlement is enabled for a plan.
 */
export function requireEntitlement(
  plan: Plan,
  entitlement: keyof typeof ENTITLEMENTS.paid,
): boolean {
  const planEntitlements = ENTITLEMENTS[plan];
  return !!planEntitlements[entitlement];
}
