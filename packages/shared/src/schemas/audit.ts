/**
 * @module audit
 * @packageDocumentation
 *
 * Zod schemas for the **audit log** subsystem.
 *
 * Every state-changing action in the system is recorded as an immutable audit
 * log entry scoped to an organization. Entries capture who performed the action
 * (`actor_id`), what was affected (`target_type` / `target_id`), and optional
 * structured metadata. Audit logs are append-only -- they have a `created_at`
 * timestamp but no `updated_at` or `deleted_at`.
 *
 * | Zod Schema             | Inferred Type    | Purpose                                      |
 * | ---------------------- | ---------------- | -------------------------------------------- |
 * | `auditLogSchema`       | `AuditLog`       | Full audit log entry from the database        |
 * | `createAuditLogSchema` | `CreateAuditLog` | Payload for recording a new audit log entry   |
 *
 * @example
 * ```ts
 * import { createAuditLogSchema, type CreateAuditLog } from '@blitz/shared/schemas/audit';
 *
 * const entry: CreateAuditLog = {
 *   org_id: '550e8400-e29b-41d4-a716-446655440000',
 *   actor_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
 *   action: 'site.published',
 *   target_type: 'site',
 *   target_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
 * };
 * const parsed = createAuditLogSchema.parse(entry);
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema, metadataSchema } from './base.js';

/**
 * Full audit log entry as stored in the `audit_logs` database table.
 *
 * Fields:
 * - `id` -- unique UUID for this entry.
 * - `org_id` -- the organization this action belongs to (RLS scope).
 * - `actor_id` -- UUID of the user who performed the action, or `null` for
 *   system-initiated actions (e.g. cron jobs, webhooks).
 * - `action` -- a dot-separated verb describing the event (e.g.
 *   `"site.published"`, `"membership.created"`). 1-100 characters.
 * - `target_type` -- the entity type affected (e.g. `"site"`, `"subscription"`).
 * - `target_id` -- UUID of the affected entity, or `null` for org-level actions.
 * - `metadata_json` -- arbitrary JSON context (max 64 KB), such as before/after
 *   snapshots or request parameters.
 * - `ip_address` -- client IP (IPv4 or IPv6, max 45 chars).
 * - `request_id` -- correlation ID for distributed tracing.
 * - `created_at` -- ISO 8601 timestamp of when the event was recorded.
 */
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

/**
 * Request payload for recording a new audit log entry.
 *
 * Requires `org_id`, `actor_id` (nullable for system actions), and `action`.
 * The remaining fields (`target_type`, `target_id`, `metadata_json`,
 * `ip_address`, `request_id`) are all optional and should be supplied when
 * available for richer audit trails. Server-managed fields (`id`,
 * `created_at`) are omitted and assigned automatically.
 */
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

/** Inferred TypeScript type for a full audit log entry. */
export type AuditLog = z.infer<typeof auditLogSchema>;

/** Inferred TypeScript type for the create-audit-log request payload. */
export type CreateAuditLog = z.infer<typeof createAuditLogSchema>;
