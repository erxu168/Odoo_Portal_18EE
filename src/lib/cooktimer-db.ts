/**
 * KDS Cooking Timer — SQLite layer (data/portal.db).
 *
 * Owns the cook stations, cook profiles + steps, the running timers, and the
 * line-level ready rows the main KDS reads. Zero Odoo writes — same read-only
 * stance as the KDS. Lazy ensureTables() pattern, matching kds-db.ts.
 *
 * Timekeeping: step_started_at / created_at / finished_at are offset-bearing
 * Berlin stamps (see cooktimer-time.ts) so a reload recovers exact remaining
 * time. State transitions are transactional and use compare-and-swap on the
 * step index (expectedStep) to make double-taps and cross-tablet races no-ops.
 */
import { getDb } from './db';
import { berlinStamp, stampToEpoch } from './cooktimer-time';
import type {
  CookStation, CookProfile, CookStep, CoveredLine, CookTimerDTO, DoneEntry,
} from '@/types/cooktimer';

let _ctInit = false;

function ensureCookTables() {
  if (_ctInit) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cook_stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cook_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_product_id INTEGER,
      name TEXT NOT NULL,
      station_id INTEGER NOT NULL REFERENCES cook_stations(id),
      max_batch INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cook_profiles_product
      ON cook_profiles(odoo_product_id) WHERE odoo_product_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS cook_profile_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES cook_profiles(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      label TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      step_type TEXT NOT NULL CHECK(step_type IN ('cook','rest','action'))
    );
    CREATE INDEX IF NOT EXISTS idx_cook_profile_steps_profile
      ON cook_profile_steps(profile_id, seq);

    CREATE TABLE IF NOT EXISTS cook_timers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES cook_profiles(id),
      station_id INTEGER NOT NULL,
      pos_line_ids_json TEXT NOT NULL,   -- JSON: CoveredLine[] (lineId, orderId, ref, qty, arrivedMs)
      order_refs_json TEXT NOT NULL,     -- JSON: string[] distinct display refs
      current_step INTEGER NOT NULL DEFAULT 0,
      step_started_at TEXT NOT NULL,     -- offset-bearing Berlin stamp
      state TEXT NOT NULL DEFAULT 'running'
        CHECK(state IN ('running','alarm','done','finished','cancelled')),
      muted INTEGER NOT NULL DEFAULT 0,
      started_by TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cook_timers_state
      ON cook_timers(state);

    CREATE TABLE IF NOT EXISTS kds_line_ready (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pos_order_id INTEGER NOT NULL,
      pos_line_id INTEGER NOT NULL,
      timer_id INTEGER,
      ready_at INTEGER NOT NULL,          -- epoch ms
      UNIQUE(pos_order_id, pos_line_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kds_line_ready_order
      ON kds_line_ready(pos_order_id);
  `);
  // Prune finished/cancelled timers + old line-ready rows so the tables stay
  // small (the current service day is all the KDS/queue ever cares about).
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
  db.prepare("DELETE FROM cook_timers WHERE state IN ('finished','cancelled') AND finished_at IS NOT NULL AND finished_at < ?")
    .run(berlinStamp(cutoff));
  db.prepare('DELETE FROM kds_line_ready WHERE ready_at < ?').run(cutoff);

  seedStations(db);
  seedProfiles(db);
  _ctInit = true;
}

function seedStations(db: ReturnType<typeof getDb>) {
  const c = db.prepare('SELECT COUNT(*) AS c FROM cook_stations').get() as { c: number };
  if (c.c > 0) return;
  const ins = db.prepare('INSERT INTO cook_stations (name, sort, active) VALUES (?, ?, 1)');
  [['Grill', 0], ['Deep Fry & Smoker', 1], ['Oven', 2]].forEach(([n, s]) => ins.run(n, s));
}

/**
 * Placeholder cook profiles so the module is testable end to end. Cook TIMES are
 * placeholders (spec: real per-step durations are still being measured; nothing
 * in the build depends on the numbers). Product IDs are the real STAGING What a
 * Jerk products (config 14 / company 6) introspected on 2026-07-19, so queued
 * orders actually match. These are seeds only — the (step 5) Profiles manager
 * screen will let a manager edit them, and production product IDs differ (same
 * caveat as the KDS pos_config id). Not baked into any runtime logic.
 */
const SEED_PROFILES: {
  productId: number; name: string; station: string;
  steps: { label: string; type: 'cook' | 'rest' | 'action'; secs: number }[];
}[] = [
  { productId: 1682, name: 'French Fries', station: 'Deep Fry & Smoker', steps: [
    { label: '1st Fry', type: 'cook', secs: 210 },
    { label: 'Rest', type: 'rest', secs: 120 },
    { label: '2nd Fry', type: 'cook', secs: 150 },
  ] },
  { productId: 1627, name: 'Smokey Boneless Jerk Chicken', station: 'Deep Fry & Smoker', steps: [
    { label: 'Smoke', type: 'cook', secs: 720 },
    { label: 'Spray beer', type: 'action', secs: 0 },
    { label: 'Smoke', type: 'cook', secs: 480 },
  ] },
  { productId: 1628, name: 'Juicy Jerk Chicken Wings', station: 'Grill', steps: [
    { label: 'Grill', type: 'cook', secs: 300 },
    { label: 'Flip', type: 'action', secs: 0 },
    { label: 'Grill', type: 'cook', secs: 240 },
  ] },
  { productId: 1633, name: 'Fried Plantain', station: 'Deep Fry & Smoker', steps: [
    { label: 'Fry', type: 'cook', secs: 180 },
  ] },
  { productId: 1632, name: 'Festival (Dumpling) 70g', station: 'Deep Fry & Smoker', steps: [
    { label: 'Fry', type: 'cook', secs: 240 },
  ] },
  { productId: 1622, name: 'Beef & Cheese Patty', station: 'Oven', steps: [
    { label: 'Bake', type: 'cook', secs: 360 },
  ] },
];

function seedProfiles(db: ReturnType<typeof getDb>) {
  const c = db.prepare('SELECT COUNT(*) AS c FROM cook_profiles').get() as { c: number };
  if (c.c > 0) return;
  const stationId = (name: string): number => {
    const row = db.prepare('SELECT id FROM cook_stations WHERE name = ?').get(name) as { id: number } | undefined;
    return row ? row.id : 1;
  };
  const insProfile = db.prepare(
    'INSERT INTO cook_profiles (odoo_product_id, name, station_id, max_batch, active) VALUES (?, ?, ?, NULL, 1)'
  );
  const insStep = db.prepare(
    'INSERT INTO cook_profile_steps (profile_id, seq, label, duration_seconds, step_type) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const p of SEED_PROFILES) {
      const pid = insProfile.run(p.productId, p.name, stationId(p.station)).lastInsertRowid as number;
      p.steps.forEach((s, i) => insStep.run(pid, i, s.label, s.secs, s.type));
    }
  });
  tx();
}

// -- Reads --------------------------------------------------------------------

export function listStations(activeOnly = true): CookStation[] {
  ensureCookTables();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, name, sort, active FROM cook_stations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`
  ).all() as { id: number; name: string; sort: number; active: number }[];
  return rows.map(r => ({ id: r.id, name: r.name, sort: r.sort, active: !!r.active }));
}

interface ProfileRow { id: number; odoo_product_id: number | null; name: string; station_id: number; max_batch: number | null; active: number; }

function loadSteps(db: ReturnType<typeof getDb>, profileId: number): CookStep[] {
  return (db.prepare(
    'SELECT id, seq, label, duration_seconds, step_type FROM cook_profile_steps WHERE profile_id = ? ORDER BY seq'
  ).all(profileId) as { id: number; seq: number; label: string; duration_seconds: number; step_type: string }[])
    .map(s => ({ id: s.id, seq: s.seq, label: s.label, durationSeconds: s.duration_seconds, stepType: s.step_type as CookStep['stepType'] }));
}

function toProfile(db: ReturnType<typeof getDb>, r: ProfileRow, stationName: string): CookProfile {
  return {
    id: r.id, odooProductId: r.odoo_product_id, name: r.name, stationId: r.station_id,
    maxBatch: r.max_batch, active: !!r.active, steps: loadSteps(db, r.id),
  };
}

/** Active profiles keyed by their Odoo product id (for matching feed lines). */
export function getActiveProfilesByProduct(): Map<number, CookProfile & { stationName: string }> {
  ensureCookTables();
  const db = getDb();
  const stations = new Map(listStations(false).map(s => [s.id, s.name]));
  const rows = db.prepare(
    'SELECT id, odoo_product_id, name, station_id, max_batch, active FROM cook_profiles WHERE active = 1 AND odoo_product_id IS NOT NULL'
  ).all() as ProfileRow[];
  const map = new Map<number, CookProfile & { stationName: string }>();
  for (const r of rows) {
    const stationName = stations.get(r.station_id) || 'Station';
    map.set(r.odoo_product_id as number, { ...toProfile(db, r, stationName), stationName });
  }
  return map;
}

function getProfileWithStation(db: ReturnType<typeof getDb>, profileId: number): (CookProfile & { stationName: string }) | null {
  const r = db.prepare(
    'SELECT id, odoo_product_id, name, station_id, max_batch, active FROM cook_profiles WHERE id = ?'
  ).get(profileId) as ProfileRow | undefined;
  if (!r) return null;
  const st = db.prepare('SELECT name FROM cook_stations WHERE id = ?').get(r.station_id) as { name: string } | undefined;
  const stationName = st?.name || 'Station';
  return { ...toProfile(db, r, stationName), stationName };
}

/** Line ids already covered by a running timer OR already marked ready — these
 *  must never reappear in the TO COOK queue. */
export function getClaimedLineIds(): Set<number> {
  ensureCookTables();
  const db = getDb();
  const claimed = new Set<number>();
  const running = db.prepare("SELECT pos_line_ids_json FROM cook_timers WHERE state = 'running'").all() as { pos_line_ids_json: string }[];
  for (const row of running) {
    try {
      for (const l of JSON.parse(row.pos_line_ids_json) as CoveredLine[]) claimed.add(l.lineId);
    } catch { /* skip corrupt row */ }
  }
  const ready = db.prepare('SELECT pos_line_id FROM kds_line_ready').all() as { pos_line_id: number }[];
  for (const r of ready) claimed.add(r.pos_line_id);
  return claimed;
}

function rowToDTO(db: ReturnType<typeof getDb>, row: TimerRow): CookTimerDTO {
  const prof = getProfileWithStation(db, row.profile_id);
  let lines: CoveredLine[] = [];
  let orderRefs: string[] = [];
  try { lines = JSON.parse(row.pos_line_ids_json); } catch { /* keep [] */ }
  try { orderRefs = JSON.parse(row.order_refs_json); } catch { /* keep [] */ }
  return {
    id: row.id,
    profileId: row.profile_id,
    profileName: prof?.name || 'Item',
    stationId: row.station_id,
    stationName: prof?.stationName || 'Station',
    steps: prof?.steps || [],
    currentStep: row.current_step,
    stepStartedEpoch: stampToEpoch(row.step_started_at),
    state: row.state as CookTimerDTO['state'],
    muted: !!row.muted,
    orderRefs,
    lines,
    createdAtEpoch: stampToEpoch(row.created_at),
  };
}

interface TimerRow {
  id: number; profile_id: number; station_id: number; pos_line_ids_json: string;
  order_refs_json: string; current_step: number; step_started_at: string;
  state: string; muted: number; started_by: string | null; created_at: string; finished_at: string | null;
}

export function getActiveTimers(): CookTimerDTO[] {
  ensureCookTables();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM cook_timers WHERE state = 'running' ORDER BY created_at").all() as TimerRow[];
  return rows.map(r => rowToDTO(db, r));
}

export function getRecentDone(limit = 8): DoneEntry[] {
  ensureCookTables();
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, order_refs_json, finished_at, profile_id FROM cook_timers WHERE state = 'finished' ORDER BY finished_at DESC LIMIT ?"
  ).all(limit) as { id: number; order_refs_json: string; finished_at: string; profile_id: number }[];
  return rows.map(r => {
    const prof = getProfileWithStation(db, r.profile_id);
    let orderRefs: string[] = [];
    try { orderRefs = JSON.parse(r.order_refs_json); } catch { /* keep [] */ }
    return { timerId: r.id, profileName: prof?.name || 'Item', orderRefs, readyAtEpoch: stampToEpoch(r.finished_at) };
  });
}

/** Ready line ids (Set of pos_line_id) for the current KDS feed overlay. */
export function getReadyLineIds(): Set<number> {
  ensureCookTables();
  const db = getDb();
  const rows = db.prepare('SELECT pos_line_id FROM kds_line_ready').all() as { pos_line_id: number }[];
  return new Set(rows.map(r => r.pos_line_id));
}

// -- Transitions --------------------------------------------------------------

function getRow(db: ReturnType<typeof getDb>, id: number): TimerRow | undefined {
  return db.prepare('SELECT * FROM cook_timers WHERE id = ?').get(id) as TimerRow | undefined;
}

/** Line ids already claimed (running timers + ready), computed INSIDE a tx. */
function claimedLineIdsTx(db: ReturnType<typeof getDb>): Set<number> {
  const claimed = new Set<number>();
  for (const row of db.prepare("SELECT pos_line_ids_json FROM cook_timers WHERE state = 'running'").all() as { pos_line_ids_json: string }[]) {
    try { for (const l of JSON.parse(row.pos_line_ids_json) as CoveredLine[]) claimed.add(l.lineId); } catch { /* skip */ }
  }
  for (const r of db.prepare('SELECT pos_line_id FROM kds_line_ready').all() as { pos_line_id: number }[]) claimed.add(r.pos_line_id);
  return claimed;
}

/**
 * Create one timer covering 1..n lines of the SAME profile. Atomic claim: the
 * lines are re-checked against currently-claimed ids INSIDE the transaction and
 * any already taken are dropped, so two tablets tapping COOK ALL at once can't
 * both start a timer over the same line. Returns null if every line was already
 * claimed (nothing left to cook).
 */
export function createTimer(profileId: number, stationId: number, lines: CoveredLine[], startedBy?: string): CookTimerDTO | null {
  ensureCookTables();
  const db = getDb();
  return db.transaction((): CookTimerDTO | null => {
    const claimed = claimedLineIdsTx(db);
    const fresh = lines.filter(l => !claimed.has(l.lineId));
    if (fresh.length === 0) return null;
    const refs = Array.from(new Set(fresh.map(l => l.ref)));
    const now = berlinStamp();
    const id = db.prepare(
      `INSERT INTO cook_timers (profile_id, station_id, pos_line_ids_json, order_refs_json, current_step, step_started_at, state, muted, started_by, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 'running', 0, ?, ?)`
    ).run(profileId, stationId, JSON.stringify(fresh), JSON.stringify(refs), now, startedBy ?? null, now).lastInsertRowid as number;
    return rowToDTO(db, getRow(db, id)!);
  })();
}

/**
 * Advance the current alarm to the next step (or finish if it was the last).
 * Compare-and-swap on `expectedStep`: a stale/duplicate request (the step already
 * moved) is a safe no-op that just returns the current timer.
 */
export function advanceTimer(id: number, expectedStep: number): CookTimerDTO | null {
  ensureCookTables();
  const db = getDb();
  const result = db.transaction((): CookTimerDTO | null => {
    const row = getRow(db, id);
    if (!row) return null;
    if (row.state !== 'running') return rowToDTO(db, row);
    if (row.current_step !== expectedStep) return rowToDTO(db, row); // CAS miss => no-op
    const stepCount = (db.prepare('SELECT COUNT(*) AS c FROM cook_profile_steps WHERE profile_id = ?').get(row.profile_id) as { c: number }).c;
    if (expectedStep >= stepCount - 1) {
      return finishTimerInner(db, row); // last step -> finish
    }
    db.prepare("UPDATE cook_timers SET current_step = ?, step_started_at = ?, muted = 0 WHERE id = ?")
      .run(expectedStep + 1, berlinStamp(), id);
    return rowToDTO(db, getRow(db, id)!);
  })();
  return result;
}

/** Explicit mute set (not a blind toggle). Rejected if the step already moved so
 *  a late mute of step N can't silence step N+1 (spec decision 8). */
export function setTimerMute(id: number, expectedStep: number, muted: boolean): CookTimerDTO | null {
  ensureCookTables();
  const db = getDb();
  const row = getRow(db, id);
  if (!row) return null;
  if (row.state !== 'running' || row.current_step !== expectedStep) return rowToDTO(db, row);
  db.prepare('UPDATE cook_timers SET muted = ? WHERE id = ?').run(muted ? 1 : 0, id);
  return rowToDTO(db, getRow(db, id)!);
}

export function cancelTimer(id: number): CookTimerDTO | null {
  ensureCookTables();
  const db = getDb();
  const row = getRow(db, id);
  if (!row) return null;
  if (row.state !== 'running') return rowToDTO(db, row); // already terminal
  db.prepare("UPDATE cook_timers SET state = 'cancelled', finished_at = ? WHERE id = ?").run(berlinStamp(), id);
  return rowToDTO(db, getRow(db, id)!);
}

/** Terminal finish: write kds_line_ready for every covered line (idempotent). */
function finishTimerInner(db: ReturnType<typeof getDb>, row: TimerRow): CookTimerDTO {
  if (row.state === 'finished') return rowToDTO(db, row);
  const now = Date.now();
  let lines: CoveredLine[] = [];
  try { lines = JSON.parse(row.pos_line_ids_json); } catch { /* none */ }
  const insReady = db.prepare(
    'INSERT OR IGNORE INTO kds_line_ready (pos_order_id, pos_line_id, timer_id, ready_at) VALUES (?, ?, ?, ?)'
  );
  for (const l of lines) insReady.run(l.orderId, l.lineId, row.id, now);
  db.prepare("UPDATE cook_timers SET state = 'finished', finished_at = ? WHERE id = ?").run(berlinStamp(now), row.id);
  return rowToDTO(db, getRow(db, row.id)!);
}

export function finishTimer(id: number, expectedStep?: number): CookTimerDTO | null {
  ensureCookTables();
  const db = getDb();
  return db.transaction((): CookTimerDTO | null => {
    const row = getRow(db, id);
    if (!row) return null;
    if (row.state === 'finished') return rowToDTO(db, row);   // idempotent
    if (row.state !== 'running') return rowToDTO(db, row);    // cancelled
    if (typeof expectedStep === 'number' && row.current_step !== expectedStep) return rowToDTO(db, row);
    return finishTimerInner(db, row);
  })();
}
