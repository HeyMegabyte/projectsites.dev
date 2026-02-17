/**
 * @module middleware
 * @packageDocumentation
 *
 * Authorization and entitlement helpers shared between the Cloudflare Worker
 * and any server-side consumer. These are pure functions (no framework
 * dependency) so they can be composed into Hono middleware, test harnesses,
 * or CLI tools.
 *
 * | Export              | Source          | Description                                                       |
 * | ------------------- | -------------- | ----------------------------------------------------------------- |
 * | `requireRole`       | `rbac`         | Returns `true` when a user's role meets or exceeds the minimum    |
 * | `checkPermission`   | `rbac`         | Returns `true` when a role (+ optional `billing_admin`) holds a permission |
 * | `Permission`        | `rbac`         | Union type of all fine-grained permission strings                 |
 * | `getEntitlements`   | `entitlements` | Computes the full entitlements object for an org given its plan    |
 * | `requireEntitlement`| `entitlements` | Checks whether a single boolean entitlement is enabled for a plan |
 *
 * @example
 * ```ts
 * import {
 *   requireRole,
 *   checkPermission,
 *   getEntitlements,
 *   type Permission,
 * } from '@bolt/shared/middleware';
 *
 * // Role hierarchy check: owner > admin > member > viewer
 * if (!requireRole(user.role, 'admin')) {
 *   throw new Error('Admin access required');
 * }
 *
 * // Fine-grained permission check
 * const canPublish: boolean = checkPermission(user.role, 'site:publish');
 *
 * // Compute plan entitlements for an org
 * const ent = getEntitlements(org.id, subscription.plan);
 * if (!ent.topBarHidden) {
 *   injectTopBar(response);
 * }
 * ```
 */
export { requireRole, checkPermission, type Permission } from './rbac.js';
export { getEntitlements, requireEntitlement } from './entitlements.js';
