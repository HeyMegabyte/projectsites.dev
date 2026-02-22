/**
 * @module audit
 * @description Append-only audit log service for Project Sites.
 *
 * Records all significant state changes: auth events, permission changes,
 * billing mutations, site operations, and webhook processing decisions.
 * Logs are org-scoped and ordered by `created_at DESC` for pagination.
 *
 * ## Table: `audit_logs`
 *
 * | Column         | Type   | Description                          |
 * | -------------- | ------ | ------------------------------------ |
 * | `id`           | TEXT   | UUID primary key                     |
 * | `org_id`       | TEXT   | Organization that owns the log entry |
 * | `actor_id`     | TEXT?  | User who performed the action        |
 * | `action`       | TEXT   | Dot-notation event (e.g. `site.created`) |
 * | `target_type`  | TEXT?  | Entity type affected                 |
 * | `target_id`    | TEXT?  | Entity ID affected                   |
 * | `metadata_json`| TEXT?  | Arbitrary JSON context               |
 * | `request_id`   | TEXT?  | Correlation ID for distributed trace |
 * | `created_at`   | TEXT   | ISO-8601 timestamp                   |
 *
 * @example
 * ```ts
 * import { writeAuditLog, getAuditLogs } from '../services/audit.js';
 *
 * await writeAuditLog(env.DB, {
 *   org_id: orgId,
 *   actor_id: userId,
 *   action: 'site.created',
 *   target_type: 'site',
 *   target_id: siteId,
 *   request_id: c.get('requestId'),
 * });
 *
 * const { data } = await getAuditLogs(env.DB, orgId, { limit: 25, offset: 0 });
 * ```
 *
 * @packageDocumentation
 */

import type { CreateAuditLog } from '@project-sites/shared';
import { createAuditLogSchema } from '@project-sites/shared';
import { dbInsert, dbQuery } from './db.js';

/**
 * Write an audit log entry to D1.
 *
 * Failures are logged but **never throw** — audit logging must not break
 * the request flow.
 *
 * @param db    - D1Database binding.
 * @param entry - Audit log fields (validated via Zod).
 */
export async function writeAuditLog(db: D1Database, entry: CreateAuditLog): Promise<void> {
  try {
    const validated = createAuditLogSchema.parse(entry);

    const { error } = await dbInsert(db, 'audit_logs', {
      id: crypto.randomUUID(),
      org_id: validated.org_id,
      actor_id: validated.actor_id ?? null,
      action: validated.action,
      target_type: validated.target_type ?? null,
      target_id: validated.target_id ?? null,
      metadata_json: validated.metadata_json ? JSON.stringify(validated.metadata_json) : null,
      ip_address: null,
      request_id: validated.request_id ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          service: 'audit',
          message: 'Failed to write audit log',
          error,
          entry: {
            org_id: validated.org_id,
            action: validated.action,
            request_id: validated.request_id,
          },
        }),
      );
    }
  } catch (err) {
    // Truly never throw — audit logging must not break request flow
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'audit',
        message: 'Audit log write threw unexpectedly',
        error: err instanceof Error ? err.message : String(err),
        action: entry?.action,
        org_id: entry?.org_id,
      }),
    );
  }
}

/**
 * Query audit logs for an organization with pagination.
 *
 * @param db      - D1Database binding.
 * @param orgId   - Organization ID to filter by.
 * @param options - Pagination options (`limit` defaults to 50, `offset` to 0).
 * @returns Paginated array of audit log entries.
 */
export async function getAuditLogs(
  db: D1Database,
  orgId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ data: unknown[]; error: string | null }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const result = await dbQuery<unknown>(
    db,
    'SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [orgId, limit, offset],
  );

  return { data: result.data, error: result.error };
}

/**
 * Query audit logs for a specific site within an organization.
 *
 * Retrieves logs where the target_id matches the site ID, OR where
 * metadata_json contains a reference to the site_id. This captures
 * both direct site actions and related actions (hostname changes, etc.).
 *
 * @param db     - D1Database binding.
 * @param orgId  - Organization ID to filter by.
 * @param siteId - Site ID to filter logs for.
 * @param options - Pagination options.
 * @returns Paginated array of audit log entries for the site.
 */
export async function getSiteAuditLogs(
  db: D1Database,
  orgId: string,
  siteId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ data: unknown[]; error: string | null }> {
  const limit = Math.min(options.limit ?? 100, 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const result = await dbQuery<unknown>(
    db,
    `SELECT * FROM audit_logs
     WHERE org_id = ?
       AND (target_id = ? OR metadata_json LIKE ?)
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [orgId, siteId, `%"site_id":"${siteId}"%`, limit, offset],
  );

  return { data: result.data, error: result.error };
}
