/**
 * @module middleware/auth
 * @description Bearer-token authentication middleware for Hono.
 *
 * Extracts a session token from the `Authorization: Bearer <token>` header,
 * validates it against D1, and populates `c.set('userId')` and `c.set('orgId')`
 * on the Hono context. If no token is present or the session is invalid, the
 * request continues without auth context -- individual routes decide whether
 * authentication is required.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getSession } from '../services/auth.js';
import { dbQueryOne } from '../services/db.js';

/**
 * Auth middleware that optionally populates userId and orgId on the Hono context.
 *
 * Does **not** reject unauthenticated requests -- routes that require auth
 * should check `c.get('userId')` and throw `unauthorized()` themselves.
 *
 * @example
 * ```ts
 * import { authMiddleware } from './middleware/auth.js';
 * app.use('/api/*', authMiddleware);
 * ```
 */
export const authMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (token) {
      const session = await getSession(c.env.DB, token);

      if (session) {
        c.set('userId', session.user_id);

        // Look up the user's primary org
        const membership = await dbQueryOne<{ org_id: string }>(
          c.env.DB,
          'SELECT m.org_id FROM memberships m WHERE m.user_id = ? AND m.deleted_at IS NULL LIMIT 1',
          [session.user_id],
        );

        if (membership) {
          c.set('orgId', membership.org_id);
        }
      }
    }
  }

  await next();
};
