import { z } from 'zod';
import { baseFields, nameSchema, uuidSchema } from './base.js';
import { ROLES } from '../constants/index.js';

/** Org schema */
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

/** Create org request */
export const createOrgSchema = z.object({
  name: nameSchema,
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

/** Membership schema */
export const membershipSchema = z.object({
  ...baseFields,
  user_id: uuidSchema,
  role: z.enum(ROLES),
  billing_admin: z.boolean().default(false),
});

/** Create membership */
export const createMembershipSchema = z.object({
  user_id: uuidSchema,
  org_id: uuidSchema,
  role: z.enum(ROLES),
  billing_admin: z.boolean().default(false),
});

/** Update membership role */
export const updateMembershipSchema = z.object({
  role: z.enum(ROLES).optional(),
  billing_admin: z.boolean().optional(),
});

export type Org = z.infer<typeof orgSchema>;
export type CreateOrg = z.infer<typeof createOrgSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type CreateMembership = z.infer<typeof createMembershipSchema>;
export type UpdateMembership = z.infer<typeof updateMembershipSchema>;
