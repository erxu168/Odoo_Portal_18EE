import { test, expect } from '@playwright/test';
import { roleCan } from '../src/lib/permissions';

/**
 * Floorplan capability keys in the permission registry. The map is staff-
 * visible by design (finding things is the whole point); everything that
 * mutates plans reuses the existing location-manage key, so an admin who
 * already curates spot permissions curates the floorplan with the same switch.
 */

test('staff can view the floorplan by default', () => {
  expect(roleCan('staff', 'inventory.floorplan.view', {})).toBe(true);
  expect(roleCan('manager', 'inventory.floorplan.view', {})).toBe(true);
  expect(roleCan('admin', 'inventory.floorplan.view', {})).toBe(true);
});

test('managing plans rides on inventory.location.manage (manager+)', () => {
  expect(roleCan('staff', 'inventory.location.manage', {})).toBe(false);
  expect(roleCan('manager', 'inventory.location.manage', {})).toBe(true);
  expect(roleCan('admin', 'inventory.location.manage', {})).toBe(true);
});

test('unknown keys fail closed to admin-only (the registry contract)', () => {
  expect(roleCan('staff', 'inventory.floorplan.does-not-exist', {})).toBe(false);
  expect(roleCan('manager', 'inventory.floorplan.does-not-exist', {})).toBe(false);
  expect(roleCan('admin', 'inventory.floorplan.does-not-exist', {})).toBe(true);
});

test('admin overrides can restrict the view key', () => {
  const overrides = { 'inventory.floorplan.view': ['manager', 'admin'] };
  expect(roleCan('staff', 'inventory.floorplan.view', overrides)).toBe(false);
  expect(roleCan('manager', 'inventory.floorplan.view', overrides)).toBe(true);
});
