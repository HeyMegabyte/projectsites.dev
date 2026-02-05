/**
 * Organization and membership schemas
 */
import { z } from 'zod';
import { uuidSchema, slugSchema, timestampsSchema, safeShortTextSchema } from './base.js';
import { ROLES, type Role } from '../constants/index.js';

// =============================================================================
// ORG SCHEMAS
// =============================================================================

export const orgIdSchema = uuidSchema.describe('Organization ID');

export const orgSchema = z
  .object({
    id: orgIdSchema,
    name: safeShortTextSchema.min(1, 'Organization name required').max(100),
    slug: slugSchema,
    owner_id: uuidSchema,
    stripe_customer_id: z.string().nullable(),
    subscription_status: z.enum(['active', 'past_due', 'cancelled', 'none']).default('none'),
  })
  .merge(timestampsSchema);

export type Org = z.infer<typeof orgSchema>;

export const createOrgSchema = z.object({
  name: safeShortTextSchema.min(1, 'Organization name required').max(100),
  slug: slugSchema.optional(), // Auto-generated if not provided
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z.object({
  name: safeShortTextSchema.min(1).max(100).optional(),
  slug: slugSchema.optional(),
});

export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

// =============================================================================
// MEMBERSHIP SCHEMAS
// =============================================================================

export const roleSchema = z.enum([ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER, ROLES.VIEWER]);

export const membershipSchema = z
  .object({
    id: uuidSchema,
    org_id: orgIdSchema,
    user_id: uuidSchema,
    role: roleSchema,
    is_billing_admin: z.boolean().default(false),
    invited_at: z.string().datetime().nullable(),
    accepted_at: z.string().datetime().nullable(),
    invited_by: uuidSchema.nullable(),
  })
  .merge(timestampsSchema);

export type Membership = z.infer<typeof membershipSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: roleSchema.exclude(['owner']), // Can't invite as owner
  is_billing_admin: z.boolean().default(false),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMembershipSchema = z.object({
  role: roleSchema.exclude(['owner']).optional(),
  is_billing_admin: z.boolean().optional(),
});

export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

// =============================================================================
// ORG CONTEXT (for middleware)
// =============================================================================

export const orgContextSchema = z.object({
  org_id: orgIdSchema,
  org_slug: slugSchema,
  role: roleSchema,
  is_billing_admin: z.boolean(),
  permissions: z.array(z.string()),
});

export type OrgContext = z.infer<typeof orgContextSchema>;

// =============================================================================
// PERMISSION DEFINITIONS
// =============================================================================

export const PERMISSIONS = {
  // Site permissions
  SITES_READ: 'sites:read',
  SITES_CREATE: 'sites:create',
  SITES_UPDATE: 'sites:update',
  SITES_DELETE: 'sites:delete',
  SITES_PUBLISH: 'sites:publish',

  // Domain permissions
  DOMAINS_READ: 'domains:read',
  DOMAINS_CREATE: 'domains:create',
  DOMAINS_DELETE: 'domains:delete',

  // Billing permissions
  BILLING_READ: 'billing:read',
  BILLING_MANAGE: 'billing:manage',

  // Member permissions
  MEMBERS_READ: 'members:read',
  MEMBERS_INVITE: 'members:invite',
  MEMBERS_MANAGE: 'members:manage',
  MEMBERS_REMOVE: 'members:remove',

  // Org permissions
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_DELETE: 'org:delete',

  // Admin permissions
  ADMIN_ACCESS: 'admin:access',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Permissions granted to each role */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.OWNER]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: [
    PERMISSIONS.SITES_READ,
    PERMISSIONS.SITES_CREATE,
    PERMISSIONS.SITES_UPDATE,
    PERMISSIONS.SITES_DELETE,
    PERMISSIONS.SITES_PUBLISH,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.DOMAINS_CREATE,
    PERMISSIONS.DOMAINS_DELETE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.MEMBERS_INVITE,
    PERMISSIONS.MEMBERS_MANAGE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ORG_UPDATE,
  ],
  [ROLES.MEMBER]: [
    PERMISSIONS.SITES_READ,
    PERMISSIONS.SITES_CREATE,
    PERMISSIONS.SITES_UPDATE,
    PERMISSIONS.SITES_PUBLISH,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.MEMBERS_READ,
    PERMISSIONS.ORG_READ,
  ],
  [ROLES.VIEWER]: [PERMISSIONS.SITES_READ, PERMISSIONS.DOMAINS_READ, PERMISSIONS.ORG_READ],
};
