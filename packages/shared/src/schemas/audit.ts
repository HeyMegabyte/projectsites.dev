import { z } from 'zod';
import { baseFields, uuidSchema, metadataSchema } from './base.js';

/** Audit log entry */
export const auditLogSchema = z.object({
  id: baseFields.id,
  org_id: baseFields.org_id,
  actor_id: uuidSchema.nullable(),
  action: z.string().min(1).max(100),
  target_type: z.string().max(100).nullable(),
  target_id: uuidSchema.nullable(),
  metadata_json: metadataSchema.nullable(),
  ip_address: z.string().max(45).nullable(),
  request_id: z.string().max(255).nullable(),
  created_at: baseFields.created_at,
});

/** Create audit log entry */
export const createAuditLogSchema = z.object({
  org_id: uuidSchema,
  actor_id: uuidSchema.nullable(),
  action: z.string().min(1).max(100),
  target_type: z.string().max(100).optional(),
  target_id: uuidSchema.optional(),
  metadata_json: metadataSchema.optional(),
  ip_address: z.string().max(45).optional(),
  request_id: z.string().max(255).optional(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;
export type CreateAuditLog = z.infer<typeof createAuditLogSchema>;
