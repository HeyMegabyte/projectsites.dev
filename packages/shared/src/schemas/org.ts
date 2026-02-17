/**
 * @module org
 * @packageDocumentation
 *
 * Zod schemas for **organizations** and **memberships**.
 *
 * Organizations are the top-level tenant in the system. Every site, subscription,
 * and audit-log entry is scoped to an organization. Memberships link users to
 * organizations with a role-based access control (RBAC) role.
 *
 * | Zod Schema                | Inferred Type      | Purpose                                    |
 * | ------------------------- | ------------------ | ------------------------------------------ |
 * | `orgSchema`               | `Org`              | Full organization row from the database     |
 * | `createOrgSchema`         | `CreateOrg`        | Payload for creating a new organization     |
 * | `membershipSchema`        | `Membership`       | Full membership row from the database       |
 * | `createMembershipSchema`  | `CreateMembership` | Payload for creating a new membership       |
 * | `updateMembershipSchema`  | `UpdateMembership` | Partial payload for updating a membership   |
 *
 * @example
 * ```ts
 * import { createOrgSchema, type CreateOrg } from '@blitz/shared/schemas/org';
 *
 * const input: CreateOrg = { name: 'Acme Corp', slug: 'acme-corp' };
 * const parsed = createOrgSchema.parse(input);
 * ```
 */
import { z } from 'zod';
import { baseFields, nameSchema, uuidSchema } from './base.js';
import { ROLES } from '../constants/index.js';

/**
 * Full organization record as stored in the `orgs` database table.
 *
 * Validates the complete set of columns including server-managed timestamps
 * (`created_at`, `updated_at`, `deleted_at`). The `slug` must be a lowercase
 * alphanumeric string (3-63 chars) that may contain hyphens but must start and
 * end with an alphanumeric character. Slugs are used in subdomain routing
 * (e.g. `{slug}-sites.megabyte.space`).
 */
export const orgSchema = z.object({
  id: baseFields.id,
  name: nameSchema,
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  created_at: baseFields.created_at,
  updated_at: baseFields.updated_at,
  deleted_at: baseFields.deleted_at,
});

/**
 * Request payload for creating a new organization.
 *
 * Only the user-supplied fields (`name` and `slug`) are required; all
 * server-managed fields (id, timestamps) are omitted. The `slug` undergoes the
 * same validation as {@link orgSchema} and is used as the unique identifier in
 * URLs and subdomains.
 */
export const createOrgSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

/**
 * Full membership record linking a user to an organization.
 *
 * Each membership carries an RBAC `role` (`owner | admin | member | viewer`)
 * and an optional `billing_admin` flag that grants permission to manage
 * subscriptions and payment methods independently of the RBAC role.
 * Includes all {@link baseFields} (id, org_id, timestamps).
 */
export const membershipSchema = z.object({
  ...baseFields,
  user_id: uuidSchema,
  role: z.enum(ROLES),
  billing_admin: z.boolean().default(false),
});

/**
 * Request payload for creating a new membership.
 *
 * Requires explicit `user_id`, `org_id`, and `role`. The `billing_admin`
 * flag defaults to `false` when omitted.
 */
export const createMembershipSchema = z.object({
  user_id: uuidSchema,
  org_id: uuidSchema,
  role: z.enum(ROLES),
  billing_admin: z.boolean().default(false),
});

/**
 * Partial payload for updating an existing membership.
 *
 * Both `role` and `billing_admin` are optional; only the provided fields will
 * be patched. Use this schema to validate `PATCH /memberships/:id` requests.
 */
export const updateMembershipSchema = z.object({
  role: z.enum(ROLES).optional(),
  billing_admin: z.boolean().optional(),
});

/** Inferred TypeScript type for a full organization record. */
export type Org = z.infer<typeof orgSchema>;

/** Inferred TypeScript type for the create-organization request payload. */
export type CreateOrg = z.infer<typeof createOrgSchema>;

/** Inferred TypeScript type for a full membership record. */
export type Membership = z.infer<typeof membershipSchema>;

/** Inferred TypeScript type for the create-membership request payload. */
export type CreateMembership = z.infer<typeof createMembershipSchema>;

/** Inferred TypeScript type for the update-membership request payload. */
export type UpdateMembership = z.infer<typeof updateMembershipSchema>;
