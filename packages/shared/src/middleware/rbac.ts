import type { Role } from '../constants/index.js';
import { ROLES } from '../constants/index.js';

/** Permission types */
export type Permission =
  | 'org:read'
  | 'org:write'
  | 'org:delete'
  | 'site:read'
  | 'site:write'
  | 'site:delete'
  | 'site:publish'
  | 'billing:read'
  | 'billing:write'
  | 'member:read'
  | 'member:write'
  | 'member:delete'
  | 'admin:read'
  | 'admin:write';

/** Role → permission mapping */
const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: new Set<Permission>([
    'org:read',
    'org:write',
    'org:delete',
    'site:read',
    'site:write',
    'site:delete',
    'site:publish',
    'billing:read',
    'billing:write',
    'member:read',
    'member:write',
    'member:delete',
    'admin:read',
    'admin:write',
  ]),
  admin: new Set<Permission>([
    'org:read',
    'org:write',
    'site:read',
    'site:write',
    'site:delete',
    'site:publish',
    'billing:read',
    'member:read',
    'member:write',
    'admin:read',
  ]),
  member: new Set<Permission>(['org:read', 'site:read', 'site:write', 'site:publish', 'billing:read', 'member:read']),
  viewer: new Set<Permission>(['org:read', 'site:read', 'billing:read', 'member:read']),
};

/**
 * Role hierarchy: owner > admin > member > viewer.
 * Returns the index (lower = more powerful).
 */
function roleIndex(role: Role): number {
  return ROLES.indexOf(role);
}

/**
 * Check if a role meets the minimum required role level.
 */
export function requireRole(userRole: Role, minRole: Role): boolean {
  return roleIndex(userRole) <= roleIndex(minRole);
}

/**
 * Check if a role (+ optional billing_admin flag) has a specific permission.
 */
export function checkPermission(userRole: Role, permission: Permission, billingAdmin: boolean = false): boolean {
  // billing_admin flag grants billing:write regardless of role
  if (permission === 'billing:write' && billingAdmin) {
    return true;
  }

  const permissions = ROLE_PERMISSIONS[userRole];
  return permissions?.has(permission) ?? false;
}
