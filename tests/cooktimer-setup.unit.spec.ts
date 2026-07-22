import { test, expect } from '@playwright/test';
import { getDb } from '../src/lib/db';
import {
  listStationsAdmin, createStation, renameStation, setStationActive, reorderStations, deleteStation,
  listProfilesAdmin, createProfile, updateProfile, setProfileActive, deleteProfile,
  getActiveProfilesByProduct, createTimer, CookSetupError,
} from '../src/lib/cooktimer-db';

// Exercises the manager-setup CRUD against the real SQLite layer. Uses out-of-range
// synthetic product/line ids + uniquely-named stations so it never collides with
// seed data or the live feed, and cleans up everything it creates.

function rmStation(id: number) { try { getDb().prepare('DELETE FROM cook_stations WHERE id = ?').run(id); } catch { /* gone */ } }
function rmProfile(id: number) {
  const db = getDb();
  db.prepare('DELETE FROM cook_profile_steps WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM cook_timers WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM cook_profiles WHERE id = ?').run(id);
}
const uniq = () => `ZZ Test ${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

test('station CRUD: create → rename → toggle → delete', () => {
  const s = createStation(uniq());
  try {
    expect(listStationsAdmin().some(x => x.id === s.id)).toBe(true);
    expect(renameStation(s.id, 'ZZ Renamed').name).toBe('ZZ Renamed');
    expect(setStationActive(s.id, false).active).toBe(false);
    deleteStation(s.id);
    expect(listStationsAdmin().some(x => x.id === s.id)).toBe(false);
  } finally { rmStation(s.id); }
});

test('duplicate station name is rejected (409)', () => {
  const name = uniq();
  const s = createStation(name);
  try {
    let err: unknown = null;
    try { createStation(name); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CookSetupError);
    expect((err as CookSetupError).status).toBe(409);
  } finally { rmStation(s.id); }
});

test('reorderStations validates the full set and is stable', () => {
  const ids = listStationsAdmin().map(s => s.id);
  expect(reorderStations(ids).map(s => s.id)).toEqual(ids); // no-op reorder returns same order
  let err: unknown = null;
  try { reorderStations([ids[0]]); } catch (e) { err = e; } // partial set rejected
  expect(err).toBeInstanceOf(CookSetupError);
});

test('createProfile stores contiguous steps + enforces one profile per product', () => {
  const st = listStationsAdmin()[0];
  const p = createProfile({
    odooProductId: 999901, name: 'ZZ Prof A', stationId: st.id, maxBatch: null, active: true,
    steps: [
      { label: 'One', stepType: 'cook', durationSeconds: 60 },
      { label: 'Spray', stepType: 'action', durationSeconds: 999 }, // forced to 0
      { label: 'Three', stepType: 'cook', durationSeconds: 30 },
    ],
  });
  try {
    const loaded = listProfilesAdmin().find(x => x.id === p.id)!;
    expect(loaded.steps.map(s => s.seq)).toEqual([0, 1, 2]);
    expect(loaded.steps[1].stepType).toBe('action');
    expect(loaded.steps[1].durationSeconds).toBe(0); // action forced to zero
    let err: unknown = null;
    try {
      createProfile({ odooProductId: 999901, name: 'dup', stationId: st.id, maxBatch: null, active: false, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CookSetupError);
    expect((err as CookSetupError).status).toBe(409);
  } finally { rmProfile(p.id); }
});

test('updateProfile replaces the step chain wholesale', () => {
  const st = listStationsAdmin()[0];
  const p = createProfile({
    odooProductId: 999902, name: 'ZZ Prof B', stationId: st.id, maxBatch: 3, active: false,
    steps: [{ label: 'A', stepType: 'cook', durationSeconds: 100 }, { label: 'B', stepType: 'cook', durationSeconds: 50 }],
  });
  try {
    const up = updateProfile(p.id, {
      odooProductId: 999902, name: 'ZZ Prof B2', stationId: st.id, maxBatch: null, active: false,
      steps: [{ label: 'Only', stepType: 'cook', durationSeconds: 42 }],
    });
    expect(up.name).toBe('ZZ Prof B2');
    expect(up.steps.length).toBe(1);
    expect(up.steps[0].label).toBe('Only');
    expect(up.maxBatch).toBeNull();
  } finally { rmProfile(p.id); }
});

test('a profile cannot be turned on without a product', () => {
  const st = listStationsAdmin()[0];
  let createErr: unknown = null;
  try {
    createProfile({ odooProductId: null, name: 'ZZ NoProd', stationId: st.id, maxBatch: null, active: true, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
  } catch (e) { createErr = e; }
  expect(createErr).toBeInstanceOf(CookSetupError);

  const p = createProfile({ odooProductId: null, name: 'ZZ NoProd', stationId: st.id, maxBatch: null, active: false, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
  try {
    let err: unknown = null;
    try { setProfileActive(p.id, true); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CookSetupError);
  } finally { rmProfile(p.id); }
});

test('createProfile rejects a non-boolean active flag (no truthy coercion)', () => {
  const st = listStationsAdmin()[0];
  let err: unknown = null;
  try {
    // A malformed "active":"false" must be rejected, not coerced to true.
    createProfile({ odooProductId: 999905, name: 'ZZ Bad Active', stationId: st.id, maxBatch: null, active: 'false' as unknown as boolean, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
  } catch (e) { err = e; }
  expect(err).toBeInstanceOf(CookSetupError);
  // ensure nothing was created
  expect(listProfilesAdmin().some(p => p.odooProductId === 999905)).toBe(false);
});

test('seeding runs once — the durable marker is set', () => {
  listStationsAdmin(); // triggers ensureCookTables
  const marker = getDb().prepare("SELECT value FROM cook_meta WHERE key = 'seeded'").get();
  expect(marker).toBeTruthy();
});

test('an inactive station hides its products from the queue + blocks its own delete', () => {
  const st = createStation(uniq());
  const p = createProfile({ odooProductId: 999903, name: 'ZZ OnInactive', stationId: st.id, maxBatch: null, active: true, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
  try {
    expect(getActiveProfilesByProduct().has(999903)).toBe(true);
    setStationActive(st.id, false);
    expect(getActiveProfilesByProduct().has(999903)).toBe(false); // inactive station → excluded from feed
    let err: unknown = null;
    try { deleteStation(st.id); } catch (e) { err = e; } // still has a profile
    expect(err).toBeInstanceOf(CookSetupError);
    expect((err as CookSetupError).status).toBe(409);
  } finally { rmProfile(p.id); rmStation(st.id); }
});

test('deleteProfile is blocked while a timer references it', () => {
  const st = createStation(uniq());
  const p = createProfile({ odooProductId: 999904, name: 'ZZ Tmr', stationId: st.id, maxBatch: null, active: true, steps: [{ label: 'x', stepType: 'cook', durationSeconds: 10 }] });
  const t = createTimer(p.id, p.stationId, [{ lineId: 990901, orderId: 990901, ref: '#Z', qty: 1, arrivedMs: 1_700_000_000_000 }]);
  try {
    let err: unknown = null;
    try { deleteProfile(p.id); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CookSetupError);
  } finally {
    if (t) getDb().prepare('DELETE FROM cook_timers WHERE id = ?').run(t.id);
    getDb().prepare('DELETE FROM kds_line_ready WHERE pos_order_id = ?').run(990901);
    rmProfile(p.id); rmStation(st.id);
  }
});
