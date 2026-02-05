import type { CreateAuditLog } from '@project-sites/shared';
import { createAuditLogSchema } from '@project-sites/shared';
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';

/**
 * Append-only audit log service.
 * Logs auth events, permission changes, billing changes, deletes, admin actions,
 * and webhook processing decisions.
 */
export async function writeAuditLog(
  db: SupabaseClient,
  entry: CreateAuditLog,
): Promise<void> {
  const validated = createAuditLogSchema.parse(entry);

  const { error } = await supabaseQuery(db, 'audit_logs', {
    method: 'POST',
    body: {
      ...validated,
      created_at: new Date().toISOString(),
    },
  });

  if (error) {
    // Audit log failures should not break the request flow.
    // Log the error for investigation but don't throw.
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
}

/**
 * Query audit logs for an org.
 */
export async function getAuditLogs(
  db: SupabaseClient,
  orgId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ data: unknown[]; error: string | null }> {
  const { limit = 50, offset = 0 } = options;
  const query = `org_id=eq.${orgId}&order=created_at.desc&limit=${limit}&offset=${offset}`;

  const result = await supabaseQuery<unknown[]>(db, 'audit_logs', { query });
  return { data: result.data ?? [], error: result.error };
}
