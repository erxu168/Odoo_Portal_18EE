/**
 * Inventory Floorplan — persistence layer.
 *
 * Revision model: an uploaded PDF (inventory_floor_documents) is rendered into
 * one immutable revision per floor/page (inventory_floor_revisions). Text
 * labels extracted from the PDF land as review evidence
 * (inventory_floor_candidates); only what the reviewer publishes becomes
 * staff-visible anchors (inventory_floor_anchors), each pointing at a real
 * `count_locations` spot — the floorplan is a spatial view of existing
 * inventory records, never a second hierarchy.
 *
 * Conventions follow inventory-db.ts / shift-handover/db.ts: idempotent init
 * called at the top of each API route, CREATE IF NOT EXISTS + guarded ALTER
 * migrations, integer booleans, ISO timestamps, and — like the rest of the
 * portal schema — NO declared FOREIGN KEYs: parent existence is enforced in
 * code here, so a typo'd id fails loudly instead of orphaning rows.
 */
import path from 'path';
import fs from 'fs';
import { getDb } from '@/lib/db';
import type {
  AnchorDisplay,
  AnchorRow,
  CandidateKind,
  CandidateRow,
  FloorRow,
  Pt,
  RevisionRow,
} from './types';

export function nowISO(): string {
  return new Date().toISOString();
}

/** Uploaded PDFs + rendered rasters live outside the repo, next to the other upload stores. */
export const FLOORPLAN_UPLOAD_DIR = path.join(
  process.env.PORTAL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'),
  'floorplans',
);

export function ensureFloorplanUploadDir(): string {
  fs.mkdirSync(FLOORPLAN_UPLOAD_DIR, { recursive: true });
  return FLOORPLAN_UPLOAD_DIR;
}

let _inited = false;

export function initFloorplanTables(): void {
  const db = getDb();
  if (_inited) return;
  try { db.pragma('busy_timeout = 5000'); } catch { /* best effort */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_floor_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      pdf_relpath TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      uploaded_by INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      current_revision_id INTEGER,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_floors_company_name
      ON inventory_floors(company_id, lower(name));

    CREATE TABLE IF NOT EXISTS inventory_floor_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      revision_no INTEGER NOT NULL,
      source_page_number INTEGER NOT NULL DEFAULT 1,
      page_width REAL NOT NULL,
      page_height REAL NOT NULL,
      page_rotation INTEGER NOT NULL DEFAULT 0,
      raster_relpath TEXT NOT NULL,
      raster_mime TEXT NOT NULL,
      raster_width INTEGER NOT NULL,
      raster_height INTEGER NOT NULL,
      raster_bytes INTEGER NOT NULL,
      coord_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      uploaded_by INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      published_by INTEGER,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_floor_revisions_floor ON inventory_floor_revisions(floor_id);

    CREATE TABLE IF NOT EXISTS inventory_floor_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_id INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      polygon TEXT NOT NULL,
      rotation_degrees REAL NOT NULL DEFAULT 0,
      proposed_kind TEXT NOT NULL DEFAULT 'other',
      disposition TEXT NOT NULL DEFAULT 'pending',
      ignored_reason TEXT,
      linked_location_id INTEGER,
      proposed_type TEXT,
      proposed_room TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_floor_candidates_rev ON inventory_floor_candidates(revision_id);

    CREATE TABLE IF NOT EXISTS inventory_floor_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      source_candidate_id INTEGER,
      polygon TEXT NOT NULL,
      cx REAL NOT NULL,
      cy REAL NOT NULL,
      -- Where the ICON is drawn when it has been pulled out of a crowded room.
      -- NULL = drawn on the spot itself. See the leader-line note below.
      pin_cx REAL,
      pin_cy REAL,
      label TEXT NOT NULL,
      display TEXT NOT NULL DEFAULT 'overlay',
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_floor_anchors_rev ON inventory_floor_anchors(revision_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_floor_anchors_primary
      ON inventory_floor_anchors(revision_id, count_location_id) WHERE is_primary = 1;

    -- Custom location types (the editable list behind the ADD tray + Manage
    -- screen). Same shape inventory-db.ts creates; IF NOT EXISTS keeps the two
    -- inits order-independent.
    CREATE TABLE IF NOT EXISTS location_kinds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT,
      UNIQUE(company_id, kind)
    );
  `);

  // Anchor migrations (additive, same tolerance as the location_kinds block).
  // LEADER LINE: a crowded room runs out of room for its icons, so an icon may
  // be drawn OUTSIDE the room with an arrow back to the spot it marks. cx/cy
  // stay THE SPOT — every other consumer (counting, routes, the spot sheet)
  // keeps reading them unchanged. pin_cx/pin_cy are only where the icon is
  // DRAWN, and NULL means "on the spot", i.e. exactly today's behaviour.
  const anCols = (db.prepare('PRAGMA table_info(inventory_floor_anchors)').all() as { name: string }[]).map(c => c.name);
  const addAnCol = (name: string, ddl: string) => {
    if (anCols.includes(name)) return;
    try { db.exec(ddl); }
    catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
  };
  addAnCol('pin_cx', 'ALTER TABLE inventory_floor_anchors ADD COLUMN pin_cx REAL');
  addAnCol('pin_cy', 'ALTER TABLE inventory_floor_anchors ADD COLUMN pin_cy REAL');

  // location_kinds migrations (additive, tolerant of a concurrent worker adding first).
  const lkCols = (db.prepare('PRAGMA table_info(location_kinds)').all() as { name: string }[]).map(c => c.name);
  const addLkCol = (name: string, ddl: string) => {
    if (lkCols.includes(name)) return;
    try { db.exec(ddl); }
    catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
  };
  addLkCol('icon', "ALTER TABLE location_kinds ADD COLUMN icon TEXT NOT NULL DEFAULT '📍'");
  addLkCol('color', 'ALTER TABLE location_kinds ADD COLUMN color TEXT');
  // Marker shape on the plan: 'dot' (a circle — items) or 'label' (a rounded
  // rectangle — rooms, utility points). Ethan's marker library, 2026-07-31.
  addLkCol('shape', "ALTER TABLE location_kinds ADD COLUMN shape TEXT NOT NULL DEFAULT 'dot'");
  // Hierarchy rank: 1 area, 2 room, 3 item, 4 inside-an-item (see manifest.ts).
  addLkCol('layer', 'ALTER TABLE location_kinds ADD COLUMN layer INTEGER NOT NULL DEFAULT 3');
  // A built-in type the company customised or removed from ITS library. The
  // built-ins live in code (existing spots reference their keys), so "delete"
  // means hidden = 1 — reversible, and never orphans a location.
  addLkCol('hidden', 'ALTER TABLE location_kinds ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');

  _inited = true;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function createFloorDocument(d: {
  company_id: number; original_filename: string; pdf_relpath: string;
  sha256: string; byte_size: number; page_count: number; uploaded_by: number | null;
}): number {
  initFloorplanTables();
  const res = getDb().prepare(
    `INSERT INTO inventory_floor_documents
       (company_id, original_filename, pdf_relpath, sha256, byte_size, page_count, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(d.company_id, d.original_filename, d.pdf_relpath, d.sha256, d.byte_size, d.page_count, d.uploaded_by, nowISO());
  return res.lastInsertRowid as number;
}

export function findDocumentBySha(companyId: number, sha256: string): { id: number; original_filename: string; uploaded_at: string } | null {
  initFloorplanTables();
  return (getDb().prepare(
    'SELECT id, original_filename, uploaded_at FROM inventory_floor_documents WHERE company_id = ? AND sha256 = ? ORDER BY id DESC LIMIT 1',
  ).get(companyId, sha256) as { id: number; original_filename: string; uploaded_at: string } | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

export function createFloor(d: { company_id: number; name: string; code?: string; sort_order?: number; created_by: number | null }): number {
  initFloorplanTables();
  const res = getDb().prepare(
    `INSERT INTO inventory_floors (company_id, name, code, sort_order, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(d.company_id, d.name.trim(), (d.code ?? '').trim(), d.sort_order ?? 0, d.created_by, nowISO());
  return res.lastInsertRowid as number;
}

export function listFloors(companyIds: number[]): FloorRow[] {
  initFloorplanTables();
  if (companyIds.length === 0) return [];
  const ph = companyIds.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT * FROM inventory_floors WHERE active = 1 AND company_id IN (${ph}) ORDER BY company_id, sort_order, id`,
  ).all(...companyIds) as FloorRow[];
}

export function getFloor(id: number): FloorRow | null {
  initFloorplanTables();
  return (getDb().prepare('SELECT * FROM inventory_floors WHERE id = ?').get(id) as FloorRow | undefined) ?? null;
}

export function updateFloor(id: number, updates: { name?: string; code?: string; sort_order?: number; active?: number; current_revision_id?: number | null }): void {
  initFloorplanTables();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name.trim()); }
  if (updates.code !== undefined) { sets.push('code = ?'); vals.push(updates.code.trim()); }
  if (updates.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(updates.sort_order); }
  if (updates.active !== undefined) { sets.push('active = ?'); vals.push(updates.active ? 1 : 0); }
  if (updates.current_revision_id !== undefined) { sets.push('current_revision_id = ?'); vals.push(updates.current_revision_id); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(nowISO());
  vals.push(id);
  getDb().prepare(`UPDATE inventory_floors SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export function createRevision(d: {
  floor_id: number; document_id: number; source_page_number: number;
  page_width: number; page_height: number; page_rotation: number;
  raster_relpath: string; raster_mime: string;
  raster_width: number; raster_height: number; raster_bytes: number;
  uploaded_by: number | null;
}): number {
  initFloorplanTables();
  const db = getDb();
  const floor = db.prepare('SELECT id FROM inventory_floors WHERE id = ?').get(d.floor_id);
  if (!floor) throw new Error(`floor ${d.floor_id} not found`);
  const doc = db.prepare('SELECT id FROM inventory_floor_documents WHERE id = ?').get(d.document_id);
  if (!doc) throw new Error(`document ${d.document_id} not found`);
  const prev = db.prepare('SELECT MAX(revision_no) AS m FROM inventory_floor_revisions WHERE floor_id = ?').get(d.floor_id) as { m: number | null };
  const res = db.prepare(
    `INSERT INTO inventory_floor_revisions
       (floor_id, document_id, revision_no, source_page_number, page_width, page_height, page_rotation,
        raster_relpath, raster_mime, raster_width, raster_height, raster_bytes, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    d.floor_id, d.document_id, (prev.m ?? 0) + 1, d.source_page_number,
    d.page_width, d.page_height, d.page_rotation,
    d.raster_relpath, d.raster_mime, d.raster_width, d.raster_height, d.raster_bytes,
    d.uploaded_by, nowISO(),
  );
  return res.lastInsertRowid as number;
}

export function getRevision(id: number): RevisionRow | null {
  initFloorplanTables();
  return (getDb().prepare('SELECT * FROM inventory_floor_revisions WHERE id = ?').get(id) as RevisionRow | undefined) ?? null;
}

export function listRevisionsForFloor(floorId: number): RevisionRow[] {
  initFloorplanTables();
  return getDb().prepare(
    'SELECT * FROM inventory_floor_revisions WHERE floor_id = ? ORDER BY revision_no DESC',
  ).all(floorId) as RevisionRow[];
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function parsePolygon(raw: string): Pt[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function insertCandidates(revisionId: number, drafts: Array<{
  item_index: number; raw_text: string; normalized_text: string; polygon: Pt[];
  rotation_degrees: number; proposed_kind: CandidateKind; proposed_type?: string | null; proposed_room?: string | null;
}>): number {
  initFloorplanTables();
  const db = getDb();
  const rev = db.prepare('SELECT id, status FROM inventory_floor_revisions WHERE id = ?').get(revisionId) as { id: number; status: string } | undefined;
  if (!rev) throw new Error(`revision ${revisionId} not found`);
  if (rev.status !== 'draft') throw new Error(`revision ${revisionId} is not a draft`);
  const stmt = db.prepare(
    `INSERT INTO inventory_floor_candidates
       (revision_id, item_index, raw_text, normalized_text, polygon, rotation_degrees, proposed_kind, proposed_type, proposed_room)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const insertAll = db.transaction(() => {
    for (const c of drafts) {
      stmt.run(
        revisionId, c.item_index, c.raw_text, c.normalized_text, JSON.stringify(c.polygon),
        c.rotation_degrees, c.proposed_kind, c.proposed_type ?? null, c.proposed_room ?? null,
      );
    }
  });
  insertAll();
  return drafts.length;
}

export function listCandidates(revisionId: number): CandidateRow[] {
  initFloorplanTables();
  const rows = getDb().prepare(
    'SELECT * FROM inventory_floor_candidates WHERE revision_id = ? ORDER BY item_index',
  ).all(revisionId) as Array<Omit<CandidateRow, 'polygon'> & { polygon: string }>;
  return rows.map(r => ({ ...r, polygon: parsePolygon(r.polygon) }));
}

export function updateCandidate(id: number, updates: {
  disposition?: string; ignored_reason?: string | null; linked_location_id?: number | null;
  proposed_kind?: string; proposed_type?: string | null; proposed_room?: string | null; polygon?: Pt[];
}): void {
  initFloorplanTables();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.disposition !== undefined) { sets.push('disposition = ?'); vals.push(updates.disposition); }
  if (updates.proposed_kind !== undefined) { sets.push('proposed_kind = ?'); vals.push(updates.proposed_kind); }
  if (updates.ignored_reason !== undefined) { sets.push('ignored_reason = ?'); vals.push(updates.ignored_reason); }
  if (updates.linked_location_id !== undefined) { sets.push('linked_location_id = ?'); vals.push(updates.linked_location_id); }
  if (updates.proposed_type !== undefined) { sets.push('proposed_type = ?'); vals.push(updates.proposed_type); }
  if (updates.proposed_room !== undefined) { sets.push('proposed_room = ?'); vals.push(updates.proposed_room); }
  if (updates.polygon !== undefined) { sets.push('polygon = ?'); vals.push(JSON.stringify(updates.polygon)); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE inventory_floor_candidates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export function createAnchor(d: {
  revision_id: number; count_location_id: number; source_candidate_id?: number | null;
  polygon: Pt[]; cx: number; cy: number; label: string; display: AnchorDisplay;
  is_primary: boolean; created_by: number | null;
}): number {
  initFloorplanTables();
  const db = getDb();
  const rev = db.prepare('SELECT id FROM inventory_floor_revisions WHERE id = ?').get(d.revision_id);
  if (!rev) throw new Error(`revision ${d.revision_id} not found`);
  const res = db.prepare(
    `INSERT INTO inventory_floor_anchors
       (revision_id, count_location_id, source_candidate_id, polygon, cx, cy, label, display, is_primary, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    d.revision_id, d.count_location_id, d.source_candidate_id ?? null, JSON.stringify(d.polygon),
    d.cx, d.cy, d.label, d.display, d.is_primary ? 1 : 0, d.created_by, nowISO(),
  );
  return res.lastInsertRowid as number;
}

export function listAnchors(revisionId: number): AnchorRow[] {
  initFloorplanTables();
  const rows = getDb().prepare(
    'SELECT * FROM inventory_floor_anchors WHERE revision_id = ? ORDER BY id',
  ).all(revisionId) as Array<Omit<AnchorRow, 'polygon'> & { polygon: string }>;
  return rows.map(r => ({ ...r, polygon: parsePolygon(r.polygon) }));
}

export function updateAnchorPosition(id: number, updates: { polygon: Pt[]; cx: number; cy: number; label?: string }): void {
  initFloorplanTables();
  if (updates.label !== undefined) {
    getDb().prepare('UPDATE inventory_floor_anchors SET polygon = ?, cx = ?, cy = ?, label = ? WHERE id = ?')
      .run(JSON.stringify(updates.polygon), updates.cx, updates.cy, updates.label, id);
  } else {
    getDb().prepare('UPDATE inventory_floor_anchors SET polygon = ?, cx = ?, cy = ? WHERE id = ?')
      .run(JSON.stringify(updates.polygon), updates.cx, updates.cy, id);
  }
}

/**
 * Move the ICON only — the leader-line pull-out. `null` clears it, snapping
 * the icon back onto its spot. cx/cy (the spot itself) are never touched here,
 * so pulling an icon out can never move the thing it marks.
 */
export function updateAnchorPin(id: number, pin: Pt | null): boolean {
  initFloorplanTables();
  // display = 'pin' is enforced HERE, not only in the route. An 'overlay'
  // anchor is a shape, not an icon, so a pull-out coordinate on one is data
  // no screen can render — the kind of inconsistency that outlives the bug
  // that wrote it.
  //
  // Returns whether a row actually changed: between the route's check and this
  // write the anchor can be deleted by another manager, and reporting success
  // for a write that hit nothing would leave the screen showing a lie.
  const res = getDb().prepare(
    "UPDATE inventory_floor_anchors SET pin_cx = ?, pin_cy = ? WHERE id = ? AND display = 'pin'",
  ).run(pin ? pin.x : null, pin ? pin.y : null, id);
  return res.changes === 1;
}

export function getAnchor(id: number): AnchorRow | null {
  initFloorplanTables();
  const r = getDb().prepare('SELECT * FROM inventory_floor_anchors WHERE id = ?').get(id) as (Omit<AnchorRow, 'polygon'> & { polygon: string }) | undefined;
  return r ? { ...r, polygon: parsePolygon(r.polygon) } : null;
}

export function deleteAnchor(id: number): void {
  initFloorplanTables();
  getDb().prepare('DELETE FROM inventory_floor_anchors WHERE id = ?').run(id);
}

/**
 * Color of a custom location type (location_kinds is owned by inventory-db;
 * only the floorplan needs color, so the setter lives here, not there).
 */
export function setLocationKindColor(id: number, companyId: number, color: string | null): void {
  initFloorplanTables();
  getDb().prepare('UPDATE location_kinds SET color = ? WHERE id = ? AND company_id = ?').run(color, id, companyId);
}

/** Marker shape of a custom type: 'dot' (circle) or 'label' (rounded rectangle). */
export function setLocationKindShape(id: number, companyId: number, shape: string): void {
  initFloorplanTables();
  getDb().prepare('UPDATE location_kinds SET shape = ? WHERE id = ? AND company_id = ?').run(shape, id, companyId);
}

/**
 * Create or update THIS company's row for a type key. Built-in keys get an
 * override row (same key) so the whole library is editable — Ethan's rule:
 * anything on screen must be editable and removable.
 */
export function upsertLocationKind(companyId: number, kind: string, fields: {
  label?: string; icon?: string; color?: string | null;
  shape?: string; layer?: number; hidden?: 0 | 1; createdBy?: number | null;
}): number {
  initFloorplanTables();
  const db = getDb();
  const existing = db.prepare('SELECT id FROM location_kinds WHERE company_id = ? AND kind = ?')
    .get(companyId, kind) as { id: number } | undefined;
  if (!existing) {
    const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM location_kinds WHERE company_id = ?')
      .get(companyId) as { m: number }).m;
    const res = db.prepare(
      `INSERT INTO location_kinds (company_id, kind, label, icon, color, shape, layer, hidden, sort_order, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      companyId, kind, fields.label ?? kind, fields.icon ?? '📍', fields.color ?? null,
      fields.shape ?? 'dot', fields.layer ?? 3, fields.hidden ?? 0, maxSort + 10,
      fields.createdBy ?? null, nowISO(),
    );
    return res.lastInsertRowid as number;
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, val] of [
    ['label', fields.label], ['icon', fields.icon], ['color', fields.color],
    ['shape', fields.shape], ['layer', fields.layer], ['hidden', fields.hidden],
  ] as Array<[string, unknown]>) {
    if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val); }
  }
  if (sets.length) {
    vals.push(existing.id);
    db.prepare(`UPDATE location_kinds SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  return existing.id;
}

/** Hierarchy rank of a custom type (1 area … 4 inside an item). */
export function setLocationKindLayer(id: number, companyId: number, layer: number): void {
  initFloorplanTables();
  getDb().prepare('UPDATE location_kinds SET layer = ? WHERE id = ? AND company_id = ?').run(layer, id, companyId);
}

/**
 * Where a spot lives on the published map — or null. Only PUBLISHED revisions
 * of ACTIVE floors count: a draft/superseded revision or an archived floor must
 * never leak into staff search, QR deep links, or "Show on map".
 */
export function getPrimaryAnchorForLocation(countLocationId: number): { floor_id: number; revision_id: number; cx: number; cy: number } | null {
  initFloorplanTables();
  const row = getDb().prepare(`
    SELECT f.id AS floor_id, r.id AS revision_id, a.cx, a.cy
    FROM inventory_floor_anchors a
    JOIN inventory_floor_revisions r ON r.id = a.revision_id AND r.status = 'published'
    JOIN inventory_floors f ON f.id = r.floor_id AND f.active = 1 AND f.current_revision_id = r.id
    WHERE a.count_location_id = ? AND a.is_primary = 1
    ORDER BY r.id DESC LIMIT 1
  `).get(countLocationId) as { floor_id: number; revision_id: number; cx: number; cy: number } | undefined;
  return row ?? null;
}
