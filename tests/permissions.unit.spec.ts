import { test, expect } from '@playwright/test';
import {
  roleCan, allowedRolesFor, allowedActionKeysForRole,
  PERMISSIONS_MANAGE_KEY, PERMISSION_ACTIONS, isValidRoleArray,
} from '../src/lib/permissions';

test('defaults apply when there is no override', () => {
  // shifts.shift.manage defaults to manager+admin (not staff)
  expect(roleCan('staff', 'shifts.shift.manage', {})).toBe(false);
  expect(roleCan('manager', 'shifts.shift.manage', {})).toBe(true);
  expect(roleCan('admin', 'shifts.shift.manage', {})).toBe(true);
});

test('view action is allowed for all roles by default', () => {
  expect(roleCan('staff', 'shifts.schedule.view', {})).toBe(true);
});

test('an override replaces the default for that action only', () => {
  const overrides = { 'shifts.shift.manage': ['staff', 'manager', 'admin'] as const };
  expect(roleCan('staff', 'shifts.shift.manage', overrides as any)).toBe(true);
  // a different action is untouched
  expect(roleCan('staff', 'shifts.schedule.publish', overrides as any)).toBe(false);
});

test('permissions.manage is hard-locked to admin even if an override says otherwise', () => {
  const overrides = { [PERMISSIONS_MANAGE_KEY]: ['staff', 'manager', 'admin'] as any };
  expect(roleCan('staff', PERMISSIONS_MANAGE_KEY, overrides)).toBe(false);
  expect(roleCan('manager', PERMISSIONS_MANAGE_KEY, overrides)).toBe(false);
  expect(roleCan('admin', PERMISSIONS_MANAGE_KEY, overrides)).toBe(true);
  expect(allowedRolesFor(PERMISSIONS_MANAGE_KEY, overrides)).toEqual(['admin']);
});

test('allowedActionKeysForRole returns every key the role can do', () => {
  const keys = allowedActionKeysForRole('staff', {});
  expect(keys).toContain('shifts.schedule.view');
  expect(keys).not.toContain('shifts.shift.manage');
});

test('an unknown action key fails closed (admin only)', () => {
  expect(roleCan('staff', 'nonsense.key', {})).toBe(false);
  expect(roleCan('manager', 'nonsense.key', {})).toBe(false);
  expect(roleCan('admin', 'nonsense.key', {})).toBe(true);
});

test('every action key is unique and every default is a valid non-empty role subset', () => {
  const seen = new Set<string>();
  for (const a of PERMISSION_ACTIONS) {
    expect(seen.has(a.key)).toBe(false);
    seen.add(a.key);
    expect(isValidRoleArray(a.defaultRoles)).toBe(true);
    expect(a.defaultRoles.length).toBeGreaterThan(0);
  }
});

test('manufacturing defaults are behavior-preserving (manager-only writes, all-role reads/edits)', () => {
  // requireRole('manager') today → manager+admin, staff blocked
  expect(roleCan('staff', 'manufacturing.mo.create', {})).toBe(false);
  expect(roleCan('manager', 'manufacturing.mo.create', {})).toBe(true);
  expect(roleCan('staff', 'manufacturing.bom.edit', {})).toBe(false);
  expect(roleCan('staff', 'manufacturing.shelflife.edit', {})).toBe(false);
  // requireAuth() today (any logged-in user) → all roles
  expect(roleCan('staff', 'manufacturing.mo.components', {})).toBe(true);
  expect(roleCan('staff', 'manufacturing.bom.setcurrent', {})).toBe(true);
});

test('purchase defaults are behavior-preserving', () => {
  // hasRole('manager') today → manager+admin, staff blocked
  expect(roleCan('staff', 'purchase.supplier.manage', {})).toBe(false);
  expect(roleCan('staff', 'purchase.guide.manage', {})).toBe(false);
  expect(roleCan('staff', 'purchase.receive.confirm', {})).toBe(false);
  expect(roleCan('manager', 'purchase.receive.confirm', {})).toBe(true);
  // hasRole('admin') today → admin only
  expect(roleCan('manager', 'purchase.suppliers.seed', {})).toBe(false);
  expect(roleCan('admin', 'purchase.suppliers.seed', {})).toBe(true);
  // no role gate today (any logged-in user) → all roles
  expect(roleCan('staff', 'purchase.order.send', {})).toBe(true);
});
