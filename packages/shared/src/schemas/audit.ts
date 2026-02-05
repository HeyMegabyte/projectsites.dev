/**
 * Audit log schemas
 */
import { z } from 'zod';
import { uuidSchema, isoDateTimeSchema } from './base.js';
import { orgIdSchema } from './org.js';
import { AUDIT_ACTIONS, type AuditAction } from '../constants/index.js';

// =============================================================================
// AUDIT LOG SCHEMA
// =============================================================================

export const auditActionSchema = z.enum(
  Object.values(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]],
);

export const auditLogSchema = z.object({
  id: uuidSchema,
  org_id: orgIdSchema,
  actor_id: uuidSchema.nullable(), // null for system actions
  actor_type: z.enum(['user', 'system', 'webhook', 'job']),
  action: auditActionSchema,
  target_type: z.string().max(50),
  target_id: z.string().max(100).nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().max(500).nullable(),
  request_id: z.string().nullable(),
  created_at: isoDateTimeSchema,
});

export type AuditLog = z.infer<typeof auditLogSchema>;

// =============================================================================
// CREATE AUDIT LOG INPUT
// =============================================================================

export const createAuditLogSchema = z.object({
  org_id: orgIdSchema,
  actor_id: uuidSchema.nullable(),
  actor_type: z.enum(['user', 'system', 'webhook', 'job']),
  action: auditActionSchema,
  target_type: z.string().max(50),
  target_id: z.string().max(100).nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().max(500).nullable(),
  request_id: z.string().nullable(),
});

export type CreateAuditLogInput = z.infer<typeof createAuditLogSchema>;

// =============================================================================
// AUDIT LOG QUERY
// =============================================================================

export const auditLogQuerySchema = z.object({
  org_id: orgIdSchema.optional(),
  actor_id: uuidSchema.optional(),
  action: auditActionSchema.optional(),
  target_type: z.string().optional(),
  target_id: z.string().optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
