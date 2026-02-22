import { requireRole, checkPermission } from '../middleware/rbac';
import { getEntitlements, requireEntitlement } from '../middleware/entitlements';
import type { Role } from '../constants/index';

// ─── RBAC ────────────────────────────────────────────────────

describe('requireRole', () => {
  it('owner meets owner requirement', () => {
    expect(requireRole('owner', 'owner')).toBe(true);
  });

  it('owner meets admin requirement', () => {
    expect(requireRole('owner', 'admin')).toBe(true);
  });

  it('owner meets member requirement', () => {
    expect(requireRole('owner', 'member')).toBe(true);
  });

  it('owner meets viewer requirement', () => {
    expect(requireRole('owner', 'viewer')).toBe(true);
  });

  it('admin does not meet owner requirement', () => {
    expect(requireRole('admin', 'owner')).toBe(false);
  });

  it('admin meets admin requirement', () => {
    expect(requireRole('admin', 'admin')).toBe(true);
  });

  it('member does not meet admin requirement', () => {
    expect(requireRole('member', 'admin')).toBe(false);
  });

  it('viewer meets only viewer requirement', () => {
    expect(requireRole('viewer', 'viewer')).toBe(true);
    expect(requireRole('viewer', 'member')).toBe(false);
    expect(requireRole('viewer', 'admin')).toBe(false);
    expect(requireRole('viewer', 'owner')).toBe(false);
  });
});

describe('checkPermission', () => {
  it('owner has all permissions', () => {
    expect(checkPermission('owner', 'org:read')).toBe(true);
    expect(checkPermission('owner', 'org:write')).toBe(true);
    expect(checkPermission('owner', 'org:delete')).toBe(true);
    expect(checkPermission('owner', 'site:read')).toBe(true);
    expect(checkPermission('owner', 'site:write')).toBe(true);
    expect(checkPermission('owner', 'site:delete')).toBe(true);
    expect(checkPermission('owner', 'site:publish')).toBe(true);
    expect(checkPermission('owner', 'billing:read')).toBe(true);
    expect(checkPermission('owner', 'billing:write')).toBe(true);
    expect(checkPermission('owner', 'member:read')).toBe(true);
    expect(checkPermission('owner', 'member:write')).toBe(true);
    expect(checkPermission('owner', 'member:delete')).toBe(true);
    expect(checkPermission('owner', 'admin:read')).toBe(true);
    expect(checkPermission('owner', 'admin:write')).toBe(true);
  });

  it('admin cannot delete org', () => {
    expect(checkPermission('admin', 'org:delete')).toBe(false);
  });

  it('admin cannot write billing without billing_admin flag', () => {
    expect(checkPermission('admin', 'billing:write')).toBe(false);
  });

  it('admin can write billing with billing_admin flag', () => {
    expect(checkPermission('admin', 'billing:write', true)).toBe(true);
  });

  it('member cannot delete sites', () => {
    expect(checkPermission('member', 'site:delete')).toBe(false);
  });

  it('member can publish sites', () => {
    expect(checkPermission('member', 'site:publish')).toBe(true);
  });

  it('viewer has only read permissions', () => {
    expect(checkPermission('viewer', 'org:read')).toBe(true);
    expect(checkPermission('viewer', 'site:read')).toBe(true);
    expect(checkPermission('viewer', 'billing:read')).toBe(true);
    expect(checkPermission('viewer', 'member:read')).toBe(true);
    expect(checkPermission('viewer', 'org:write')).toBe(false);
    expect(checkPermission('viewer', 'site:write')).toBe(false);
    expect(checkPermission('viewer', 'site:publish')).toBe(false);
  });

  it('billing_admin flag grants billing:write to any role', () => {
    const roles: Role[] = ['owner', 'admin', 'member', 'viewer'];
    for (const role of roles) {
      expect(checkPermission(role, 'billing:write', true)).toBe(true);
    }
  });

  it('billing_admin flag does not grant other permissions', () => {
    expect(checkPermission('viewer', 'org:write', true)).toBe(false);
    expect(checkPermission('viewer', 'site:write', true)).toBe(false);
  });
});

// ─── Entitlements ────────────────────────────────────────────

describe('getEntitlements', () => {
  const orgId = '00000000-0000-4000-8000-000000000001';

  it('returns free entitlements', () => {
    const ent = getEntitlements(orgId, 'free');
    expect(ent.topBarHidden).toBe(false);
    expect(ent.maxCustomDomains).toBe(0);
    expect(ent.chatEnabled).toBe(true);
    expect(ent.analyticsEnabled).toBe(false);
    expect(ent.plan).toBe('free');
    expect(ent.org_id).toBe(orgId);
  });

  it('returns paid entitlements', () => {
    const ent = getEntitlements(orgId, 'paid');
    expect(ent.topBarHidden).toBe(true);
    expect(ent.maxCustomDomains).toBe(10);
    expect(ent.chatEnabled).toBe(true);
    expect(ent.analyticsEnabled).toBe(true);
    expect(ent.plan).toBe('paid');
  });
});

describe('requireEntitlement', () => {
  it('free plan does not have topBarHidden', () => {
    expect(requireEntitlement('free', 'topBarHidden')).toBe(false);
  });

  it('paid plan has topBarHidden', () => {
    expect(requireEntitlement('paid', 'topBarHidden')).toBe(true);
  });

  it('free plan has chatEnabled', () => {
    expect(requireEntitlement('free', 'chatEnabled')).toBe(true);
  });

  it('free plan does not have analyticsEnabled', () => {
    expect(requireEntitlement('free', 'analyticsEnabled')).toBe(false);
  });

  it('paid plan has analyticsEnabled', () => {
    expect(requireEntitlement('paid', 'analyticsEnabled')).toBe(true);
  });

  it('free plan maxCustomDomains is falsy (0)', () => {
    expect(requireEntitlement('free', 'maxCustomDomains')).toBe(false);
  });

  it('paid plan maxCustomDomains is truthy (5)', () => {
    expect(requireEntitlement('paid', 'maxCustomDomains')).toBe(true);
  });
});
