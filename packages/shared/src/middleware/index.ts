/**
 * Shared middleware helpers for API routes
 * These are framework-agnostic policy functions
 */

import { ROLE_PERMISSIONS, ROLE_HIERARCHY, type Role, type Permission } from '../schemas/org.js';
import { getEntitlements, type SubscriptionStatus, type Entitlements } from '../schemas/billing.js';

// =============================================================================
// ROLE CHECKS
// =============================================================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
}

/**
 * Check if roleA >= roleB in hierarchy
 */
export function isRoleAtLeast(roleA: Role, roleB: Role): boolean {
  return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB];
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

// =============================================================================
// ENTITLEMENT CHECKS
// =============================================================================

/**
 * Check if subscription allows custom domains
 */
export function canAddCustomDomain(
  subscriptionStatus: SubscriptionStatus,
  currentDomainCount: number,
): { allowed: boolean; reason?: string } {
  const entitlements = getEntitlements(subscriptionStatus);

  if (entitlements.maxCustomDomains === 0) {
    return {
      allowed: false,
      reason: 'Custom domains require a paid subscription',
    };
  }

  if (currentDomainCount >= entitlements.maxCustomDomains) {
    return {
      allowed: false,
      reason: `Maximum ${entitlements.maxCustomDomains} custom domains allowed`,
    };
  }

  return { allowed: true };
}

/**
 * Check if top bar should be shown
 */
export function shouldShowTopBar(subscriptionStatus: SubscriptionStatus): boolean {
  const entitlements = getEntitlements(subscriptionStatus);
  return !entitlements.topBarHidden;
}

/**
 * Check if user can access billing
 */
export function canAccessBilling(role: Role, isBillingAdmin: boolean): boolean {
  // Owner always can
  if (role === 'owner') return true;
  // Admin can if billing_admin flag is set
  if (role === 'admin' && isBillingAdmin) return true;
  // Explicit billing_admin capability
  return isBillingAdmin;
}

/**
 * Check if user can invite members
 */
export function canInviteMembers(
  role: Role,
  subscriptionStatus: SubscriptionStatus,
): { allowed: boolean; reason?: string } {
  const entitlements = getEntitlements(subscriptionStatus);

  if (!entitlements.canInviteMembers) {
    return {
      allowed: false,
      reason: 'Team features require a paid subscription',
    };
  }

  if (!hasPermission(role, 'members:invite')) {
    return {
      allowed: false,
      reason: 'Insufficient permissions to invite members',
    };
  }

  return { allowed: true };
}

// =============================================================================
// RATE LIMIT HELPERS
// =============================================================================

export interface RateLimitConfig {
  /** Maximum requests allowed */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth_magic_link: { limit: 5, windowSeconds: 3600 }, // 5 per hour
  auth_otp_request: { limit: 10, windowSeconds: 3600 }, // 10 per hour
  auth_otp_verify: { limit: 5, windowSeconds: 300 }, // 5 per 5 minutes
  auth_login: { limit: 20, windowSeconds: 60 }, // 20 per minute
  site_create: { limit: 10, windowSeconds: 3600 }, // 10 per hour
  site_publish: { limit: 5, windowSeconds: 300 }, // 5 per 5 minutes
  api_general: { limit: 100, windowSeconds: 60 }, // 100 per minute
  webhook: { limit: 1000, windowSeconds: 60 }, // 1000 per minute
};

/**
 * Generate rate limit key
 */
export function rateLimitKey(scope: string, identifier: string): string {
  return `ratelimit:${scope}:${identifier}`;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if request size is within limits
 */
export function isRequestSizeValid(contentLength: number, maxBytes: number = 256 * 1024): boolean {
  return contentLength <= maxBytes;
}

/**
 * Check if hostname is allowed for custom domains
 */
export function isHostnameAllowed(hostname: string, blockedPatterns: string[] = []): boolean {
  const lower = hostname.toLowerCase();

  // Block our own domains
  const internalPatterns = [
    'megabyte.space',
    'claimyour.site',
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
  ];

  for (const pattern of [...internalPatterns, ...blockedPatterns]) {
    if (lower === pattern || lower.endsWith(`.${pattern}`)) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// ERROR CREATION HELPERS
// =============================================================================

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export function createError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      ...(details && { details }),
      ...(requestId && { request_id: requestId }),
    },
  };
}

export function getHttpStatus(code: ErrorCode): number {
  const statusMap: Record<ErrorCode, number> = {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    VALIDATION_ERROR: 400,
    RATE_LIMITED: 429,
    INTERNAL_ERROR: 500,
  };
  return statusMap[code];
}
