import { test, expect } from '@playwright/test';
import {
  computeSnapshotHash,
  buildHandoverSections,
  type PreviewContainer,
  type PreviewAction,
} from '../src/lib/shift-handover/snapshot';

function c(partial: Partial<PreviewContainer>): PreviewContainer {
  return {
    id: 1,
    batch_id: 1,
    product_id: 1,
    product_name: 'Smoked Jerk Chicken',
    product_kind: 'finished',
    container_code: 'A',
    container_type_name: 'GN 1/2',
    fill_level: 100,
    preparation_state: 'ready',
    availability_state: 'ready_for_service',
    storage_location_id: 10,
    storage_location_name: 'Countertop Fridge',
    use_first: 0,
    next_action: null,
    status: 'active',
    ...partial,
  };
}

function a(partial: Partial<PreviewAction>): PreviewAction {
  return {
    id: 1,
    instruction: 'Move to fridge',
    priority: 'normal',
    status: 'open',
    due_at: null,
    container_id: null,
    batch_id: null,
    ...partial,
  };
}

// ── Snapshot hash ────────────────────────────────────────────────────────────

test('the snapshot hash is stable regardless of object key or array order', () => {
  const h1 = computeSnapshotHash({
    containers: [{ id: 1, fill: 100 }, { id: 2, fill: 50 }],
    actions: [{ id: 7 }],
  });
  const h2 = computeSnapshotHash({
    actions: [{ id: 7 }],
    containers: [{ fill: 50, id: 2 }, { fill: 100, id: 1 }],
  });
  expect(h1).toBe(h2);
  expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
});

test('changing any snapshotted value changes the hash', () => {
  const h1 = computeSnapshotHash({ containers: [{ id: 1, fill: 100 }] });
  const h2 = computeSnapshotHash({ containers: [{ id: 1, fill: 75 }] });
  expect(h1).not.toBe(h2);
});

// ── Section grouping (auto-generated handover) ───────────────────────────────

test('containers are grouped into the handover display sections by availability', () => {
  const s = buildHandoverSections(
    [
      c({ id: 1, availability_state: 'ready_for_service', preparation_state: 'ready' }),
      c({ id: 2, availability_state: 'backup_stock', preparation_state: 'chilled' }),
      c({ id: 3, availability_state: 'not_ready', preparation_state: 'cooling' }),
    ],
    [],
    { 1: 'finished', 2: 'finished', 3: 'finished' },
  );
  expect(s.ready_for_service.map((x) => x.id)).toEqual([1]);
  expect(s.backup_stock.map((x) => x.id)).toEqual([2]);
  expect(s.in_production_or_cooling.map((x) => x.id)).toEqual([3]);
  expect(s.no_production).toBe(false);
});

test('a cooling container lands in "in production or cooling" even if availability is blank', () => {
  const s = buildHandoverSections(
    [c({ id: 5, availability_state: 'not_ready', preparation_state: 'cooling' })],
    [], { 5: 'finished' },
  );
  expect(s.in_production_or_cooling.map((x) => x.id)).toEqual([5]);
});

test('use-first and components are cross-cutting sections', () => {
  const s = buildHandoverSections(
    [
      c({ id: 1, use_first: 1, availability_state: 'ready_for_service' }),
      c({ id: 2, product_kind: 'component', availability_state: 'backup_stock', product_name: 'Coleslaw Dressing' }),
    ],
    [], { 1: 'finished', 2: 'component' },
  );
  expect(s.use_first.map((x) => x.id)).toEqual([1]);
  expect(s.components_prepared.map((x) => x.id)).toEqual([2]);
  // the use-first container still appears in its availability section too
  expect(s.ready_for_service.map((x) => x.id)).toEqual([1]);
});

test('on-hold and expired containers surface in the hold/discrepancy section', () => {
  const s = buildHandoverSections(
    [
      c({ id: 1, availability_state: 'on_hold' }),
      c({ id: 2, availability_state: 'expired' }),
    ],
    [], { 1: 'finished', 2: 'finished' },
  );
  expect(s.on_hold_or_discrepancy.map((x) => x.id).sort()).toEqual([1, 2]);
});

test('depleted and discarded containers are excluded from active stock sections', () => {
  const s = buildHandoverSections(
    [
      c({ id: 1, status: 'depleted', availability_state: 'depleted' }),
      c({ id: 2, status: 'discarded', availability_state: 'discarded' }),
    ],
    [], { 1: 'finished', 2: 'finished' },
  );
  expect(s.ready_for_service).toEqual([]);
  expect(s.backup_stock).toEqual([]);
  expect(s.no_production).toBe(true); // no active containers
});

test('only open / in-progress actions are "actions required"', () => {
  const s = buildHandoverSections(
    [c({ id: 1 })],
    [
      a({ id: 1, status: 'open' }),
      a({ id: 2, status: 'in_progress' }),
      a({ id: 3, status: 'done' }),
      a({ id: 4, status: 'cancelled' }),
    ],
    { 1: 'finished' },
  );
  expect(s.actions_required.map((x) => x.id).sort()).toEqual([1, 2]);
});

test('no_production is true when there are no active containers at all', () => {
  const s = buildHandoverSections([], [], {});
  expect(s.no_production).toBe(true);
  expect(s.ready_for_service).toEqual([]);
});
