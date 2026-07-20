import { test, expect } from '@playwright/test';
import {
  PREPARATION_STATES,
  AVAILABILITY_STATES,
  QUANTITY_METHODS,
  FILL_LEVELS,
  validateContainer,
  isServeablePrep,
  containerLabel,
  type ContainerValidationInput,
} from '../src/lib/shift-handover/states';

// A known-good active container used as the baseline for negative cases.
function base(): ContainerValidationInput {
  return {
    status: 'active',
    preparation_state: 'chilled',
    availability_state: 'backup_stock',
    storage_location_id: 42,
    fill_level: 100,
    quantity_method: 'container_estimate',
    photo_count: 0,
    photo_policy: 'optional',
  };
}

function codes(input: ContainerValidationInput): string[] {
  return validateContainer(input).errors.map((e) => e.code);
}

test('enums expose the agreed vocabularies', () => {
  expect(FILL_LEVELS).toEqual([0, 25, 50, 75, 100]);
  expect(PREPARATION_STATES).toContain('cooling');
  expect(PREPARATION_STATES).toContain('ready');
  expect(AVAILABILITY_STATES).toContain('ready_for_service');
  expect(AVAILABILITY_STATES).toContain('backup_stock');
  expect(QUANTITY_METHODS).toEqual([
    'counted', 'measured', 'container_estimate', 'visual', 'unknown',
  ]);
});

test('a well-formed active container is valid', () => {
  expect(validateContainer(base()).ok).toBe(true);
  expect(validateContainer(base()).errors).toEqual([]);
});

test('an active container must have a storage location', () => {
  expect(codes({ ...base(), storage_location_id: null })).toContain('MISSING_LOCATION');
});

test('an active container must have a preparation state', () => {
  expect(codes({ ...base(), preparation_state: null })).toContain('MISSING_PREP_STATE');
});

test('a cooling container may not be marked ready for service', () => {
  const errs = codes({ ...base(), preparation_state: 'cooling', availability_state: 'ready_for_service' });
  expect(errs).toContain('NOT_SERVEABLE');
});

test('raw / smoking / cooking also block ready for service', () => {
  for (const prep of ['raw', 'smoking', 'cooking']) {
    expect(codes({ ...base(), preparation_state: prep, availability_state: 'ready_for_service' })).toContain('NOT_SERVEABLE');
  }
});

test('a chilled container CAN be ready for service', () => {
  const errs = codes({ ...base(), preparation_state: 'chilled', availability_state: 'ready_for_service' });
  expect(errs).not.toContain('NOT_SERVEABLE');
  expect(isServeablePrep('chilled')).toBe(true);
  expect(isServeablePrep('cooling')).toBe(false);
});

test('fill level must be one of the five allowed values', () => {
  expect(codes({ ...base(), fill_level: 30 })).toContain('INVALID_FILL_LEVEL');
  for (const fl of [0, 25, 50, 75, 100]) {
    // depleted-at-0 is handled by status, not fill level; keep those valid here
    const input = { ...base(), fill_level: fl, availability_state: 'backup_stock' as string };
    expect(codes(input)).not.toContain('INVALID_FILL_LEVEL');
  }
});

test('availability "depleted" requires container status depleted (and vice versa)', () => {
  expect(codes({ ...base(), availability_state: 'depleted', status: 'active' })).toContain('DEPLETED_MISMATCH');
  // consistent depleted container is valid AND exempt from the location requirement
  const depleted: ContainerValidationInput = {
    ...base(), status: 'depleted', availability_state: 'depleted', storage_location_id: null,
  };
  expect(validateContainer(depleted).ok).toBe(true);
  // a terminal status with a MISSING availability is also a mismatch (no null escape)
  expect(codes({ ...base(), status: 'depleted', availability_state: null, storage_location_id: null })).toContain('DEPLETED_MISMATCH');
  expect(codes({ ...base(), status: 'discarded', availability_state: null, storage_location_id: null })).toContain('DISCARDED_MISMATCH');
});

test('availability "discarded" requires container status discarded', () => {
  expect(codes({ ...base(), availability_state: 'discarded', status: 'active' })).toContain('DISCARDED_MISMATCH');
});

test('a mandatory photo policy blocks saving without a photo', () => {
  expect(codes({ ...base(), photo_policy: 'mandatory', photo_count: 0 })).toContain('PHOTO_REQUIRED');
  expect(codes({ ...base(), photo_policy: 'mandatory', photo_count: 2 })).not.toContain('PHOTO_REQUIRED');
});

test('optional / recommended photo policies never block saving', () => {
  expect(codes({ ...base(), photo_policy: 'optional', photo_count: 0 })).not.toContain('PHOTO_REQUIRED');
  expect(codes({ ...base(), photo_policy: 'recommended', photo_count: 0 })).not.toContain('PHOTO_REQUIRED');
});

test('unknown enum values are rejected with a stable code', () => {
  expect(codes({ ...base(), preparation_state: 'teleported' })).toContain('INVALID_PREP_STATE');
  expect(codes({ ...base(), availability_state: 'levitating' })).toContain('INVALID_AVAILABILITY_STATE');
  expect(codes({ ...base(), quantity_method: 'guessed' })).toContain('INVALID_QUANTITY_METHOD');
});

test('containerLabel produces spreadsheet-style labels for fast entry', () => {
  expect(containerLabel(0)).toBe('A');
  expect(containerLabel(1)).toBe('B');
  expect(containerLabel(25)).toBe('Z');
  expect(containerLabel(26)).toBe('AA');
  expect(containerLabel(27)).toBe('AB');
});
