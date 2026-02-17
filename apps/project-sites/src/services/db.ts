/**
 * @module db
 * @description Database access layer for Cloudflare D1 (SQLite).
 *
 * Provides a thin, type-safe wrapper around the D1 binding that every service
 * and route handler uses for CRUD operations. All queries use parameterized
 * statements to prevent SQL injection.
 *
 * ## Architecture
 *
 * | Layer          | Responsibility                |
 * | -------------- | ----------------------------- |
 * | Routes         | Parse request, call services  |
 * | Services       | Business logic, call `db.*`   |
 * | **db (here)**  | SQL execution via D1 binding  |
 *
 * ## Usage
 *
 * ```ts
 * import { dbQuery, dbInsert, dbUpdate } from '../services/db.js';
 *
 * // SELECT multiple rows
 * const sites = await dbQuery<SiteRow>(env.DB,
 *   'SELECT * FROM sites WHERE org_id = ? AND deleted_at IS NULL',
 *   [orgId],
 * );
 *
 * // INSERT a row
 * await dbInsert(env.DB, 'sites', {
 *   id: crypto.randomUUID(),
 *   org_id: orgId,
 *   slug: 'my-site',
 *   business_name: 'Acme Corp',
 * });
 *
 * // UPDATE rows
 * await dbUpdate(env.DB, 'sites',
 *   { status: 'published', current_build_version: 'v1' },
 *   'id = ?', [siteId],
 * );
 * ```
 *
 * @packageDocumentation
 */

/**
 * Result wrapper returned by all query functions.
 *
 * @typeParam T - The expected row type for SELECT queries.
 *
 * @example
 * ```ts
 * const result = await dbQuery<{ id: string }>(db, 'SELECT id FROM sites', []);
 * if (result.error) console.error(result.error);
 * for (const row of result.data) { ... }
 * ```
 */
export interface DbResult<T> {
  /** Rows returned (empty array for non-SELECT or on error). */
  data: T[];
  /** Human-readable error message, or `null` on success. */
  error: string | null;
}

/**
 * Execute a raw SQL query against D1 and return typed rows.
 *
 * Uses `db.prepare(sql).bind(...params).all()` for parameterized queries.
 * **Never** interpolate user input into the SQL string — always use `?` placeholders.
 *
 * @typeParam T - Row shape returned by the query.
 * @param db     - The D1Database binding from `env.DB`.
 * @param sql    - SQL statement with `?` placeholders.
 * @param params - Bind values (strings, numbers, booleans, or null).
 * @returns Typed result with `data` array and optional `error`.
 *
 * @example
 * ```ts
 * const { data, error } = await dbQuery<{ id: string; slug: string }>(
 *   env.DB,
 *   'SELECT id, slug FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
 *   [orgId],
 * );
 * ```
 */
export async function dbQuery<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<DbResult<T>> {
  try {
    const stmt = db.prepare(sql).bind(...params);
    const result = await stmt.all<T>();
    return { data: result.results ?? [], error: null };
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Unknown D1 error',
    };
  }
}

/**
 * Execute a SQL statement that does not return rows (INSERT, UPDATE, DELETE).
 *
 * @param db     - The D1Database binding.
 * @param sql    - SQL statement with `?` placeholders.
 * @param params - Bind values.
 * @returns Object with `error` (null on success) and metadata.
 *
 * @example
 * ```ts
 * const { error } = await dbExecute(env.DB,
 *   'DELETE FROM oauth_states WHERE id = ?',
 *   [stateRecord.id],
 * );
 * ```
 */
export async function dbExecute(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<{ error: string | null; changes: number }> {
  try {
    const stmt = db.prepare(sql).bind(...params);
    const result = await stmt.run();
    return { error: null, changes: result.meta?.changes ?? 0 };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Unknown D1 error',
      changes: 0,
    };
  }
}

/**
 * Retrieve a single row from a query, or `null` if no rows match.
 *
 * Convenience wrapper around {@link dbQuery} that returns the first result.
 *
 * @typeParam T - Expected row shape.
 * @param db     - The D1Database binding.
 * @param sql    - SQL with `?` placeholders.
 * @param params - Bind values.
 *
 * @example
 * ```ts
 * const session = await dbQueryOne<SessionRow>(env.DB,
 *   'SELECT * FROM sessions WHERE token_hash = ? AND deleted_at IS NULL',
 *   [tokenHash],
 * );
 * if (!session) throw unauthorized('Invalid session');
 * ```
 */
export async function dbQueryOne<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { data } = await dbQuery<T>(db, sql, params);
  return data[0] ?? null;
}

/**
 * Insert a row into a table using a plain object.
 *
 * Automatically generates `INSERT INTO table (col1, col2) VALUES (?, ?)` from
 * the object keys. Sets `created_at` and `updated_at` if not already present.
 *
 * @param db    - The D1Database binding.
 * @param table - Table name (must be a known table — **not** user input).
 * @param row   - Key-value pairs to insert.
 * @returns Object with `error` (null on success).
 *
 * @example
 * ```ts
 * await dbInsert(env.DB, 'sites', {
 *   id: crypto.randomUUID(),
 *   org_id: orgId,
 *   slug: 'vitos-mens-salon',
 *   business_name: "Vito's Mens Salon",
 *   status: 'draft',
 * });
 * ```
 */
export async function dbInsert(
  db: D1Database,
  table: string,
  row: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const withTimestamps: Record<string, unknown> = {
    created_at: now,
    updated_at: now,
    ...row,
  };

  const keys = Object.keys(withTimestamps);
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map((k) => withTimestamps[k]);

  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const { error } = await dbExecute(db, sql, values);
  return { error };
}

/**
 * Update rows in a table matching a WHERE clause.
 *
 * Automatically appends `updated_at = ?` with the current timestamp.
 *
 * @param db          - The D1Database binding.
 * @param table       - Table name.
 * @param updates     - Column-value pairs to SET.
 * @param whereClause - SQL WHERE fragment with `?` placeholders (e.g. `"id = ?"`).
 * @param whereParams - Bind values for the WHERE clause.
 * @returns Object with `error` and `changes` count.
 *
 * @example
 * ```ts
 * await dbUpdate(env.DB, 'sites',
 *   { status: 'published', current_build_version: version },
 *   'id = ?', [siteId],
 * );
 * ```
 */
export async function dbUpdate(
  db: D1Database,
  table: string,
  updates: Record<string, unknown>,
  whereClause: string,
  whereParams: unknown[] = [],
): Promise<{ error: string | null; changes: number }> {
  const withTimestamp: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const keys = Object.keys(withTimestamp);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => withTimestamp[k]);

  const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
  return dbExecute(db, sql, [...values, ...whereParams]);
}
