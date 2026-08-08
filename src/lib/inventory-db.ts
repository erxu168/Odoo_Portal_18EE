/**
 * Inventory Module — SQLite Schema & CRUD
 *
 * Counting templates, sessions, and entries live here.
 * Odoo remains source of truth for products, locations, and stock.quant.
 * On approval, the API route writes inventory_quantity to Odoo.
 */
import { getDb } from './db';
import { berlinToday, berlinWeekday } from './berlin-date';
import { buildLocationTree } from './location-tree';
import { MIN_TO_BASE, MAX_TO_BASE, type PackLevel } from './packaging';
import type {
  CountingTemplate, CountingSession, CountEntry, QuickCount,
  Frequency, AssignType, SessionStatus,
  CountLocation, ProductPlacement, CountMode,
  SessionCountItem, StockReceipt, ProductImage,
} from '@/types/inventory';

// ===
// SCHEMA INIT
// ===

export function initInventoryTables() {
  const db = getDb();
  // The CREATE block runs as ONE exec; if a single statement fails on a legacy DB
  // (e.g. an index over a column an old table predates) it must NOT stop the column
  // migrations below from running. Catch, log, and always continue to migrate.
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counting_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'adhoc',
      schedule_days TEXT NOT NULL DEFAULT '[]',
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      category_ids TEXT NOT NULL DEFAULT '[]',
      product_ids TEXT NOT NULL DEFAULT '[]',
      assign_type TEXT,
      assign_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES counting_templates(id),
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      assigned_user_id INTEGER,
      submitted_at TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS count_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES counting_sessions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      counted_qty REAL NOT NULL,
      system_qty REAL,
      diff REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      notes TEXT,
      counted_by INTEGER NOT NULL,
      counted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      company_id INTEGER,
      counted_qty REAL NOT NULL,
      uom TEXT NOT NULL DEFAULT 'Units',
      counted_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      reviewed_by INTEGER,
      reviewed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_template ON counting_sessions(template_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON counting_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON counting_sessions(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_entries_session ON count_entries(session_id);
    CREATE INDEX IF NOT EXISTS idx_entries_product ON count_entries(product_id);
    CREATE INDEX IF NOT EXISTS idx_quick_status ON quick_counts(status);
    CREATE INDEX IF NOT EXISTS idx_quick_product ON quick_counts(product_id);
    CREATE INDEX IF NOT EXISTS idx_quick_counted_by ON quick_counts(counted_by);

    CREATE TABLE IF NOT EXISTS product_drafts (
      odoo_product_id INTEGER PRIMARY KEY,
      barcode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_flags (
      odoo_product_id INTEGER PRIMARY KEY,
      requires_photo  INTEGER NOT NULL DEFAULT 0,
      updated_by      INTEGER,
      updated_at      TEXT
    );

    -- Products this portal created.
    --
    -- Exists because of the relevance filter on the catalog: a shared product is
    -- only listed when this restaurant actually USES it (has stock of it, buys
    -- it, builds with it, counts it). That is right for browsing 1000+ shared
    -- products and exactly wrong for one a manager created thirty seconds ago —
    -- it has none of those things yet, so it vanished from the very screen it
    -- was created on, with no way back to it but the URL.
    --
    -- Deliberately a separate table rather than a flag on product_flags: this
    -- records an EVENT (the portal made this), not a setting, and nothing should
    -- be able to clear it by changing a preference.
    CREATE TABLE IF NOT EXISTS portal_created_products (
      odoo_product_id INTEGER PRIMARY KEY,
      created_at      TEXT NOT NULL,
      created_by      INTEGER
    );

    CREATE TABLE IF NOT EXISTS count_photos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_table TEXT NOT NULL,
      source_id    INTEGER NOT NULL,
      photo        TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_count_photos_source ON count_photos(source_table, source_id);

    CREATE TABLE IF NOT EXISTS count_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'area',
      description TEXT,
      photo TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      odoo_location_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- How much of a product this restaurant wants to hold. PER COMPANY on
    -- purpose: WAJ and Ssam keep different volumes of the same thing, unlike
    -- pack size and the loose word (product_flags), which are shared.
    -- Stored in BASE units — the unit staff count in — so the ordering maths
    -- never has to guess what "2" meant.
    CREATE TABLE IF NOT EXISTS product_par (
      odoo_product_id INTEGER NOT NULL,
      company_id      INTEGER NOT NULL,
      par_min         REAL,
      par_max         REAL,
      updated_by      INTEGER,
      updated_at      TEXT,
      PRIMARY KEY (odoo_product_id, company_id)
    );

    CREATE TABLE IF NOT EXISTS product_locations (
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (odoo_product_id, count_location_id)
    );

    CREATE INDEX IF NOT EXISTS idx_count_locations_company ON count_locations(company_id);
    CREATE INDEX IF NOT EXISTS idx_count_locations_parent ON count_locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_product_locations_loc ON product_locations(count_location_id);

    CREATE TABLE IF NOT EXISTS session_location_status (
      session_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      skip_reason TEXT,
      updated_at TEXT,
      PRIMARY KEY (session_id, count_location_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_migrations (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

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

    -- "Count by" unit vocabulary (piece/bunch/crate…). GLOBAL, not per-company:
    -- product_flags.pack_label is one value per (shared) product, so the unit
    -- list is naturally shared across restaurants. Editable by product managers.
    CREATE TABLE IF NOT EXISTS pack_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT,
      UNIQUE(label)
    );

    -- How a product NESTS: a box holds packs, a pack holds pieces. One row per
    -- level; to_base is how many BASE units ONE of them is (see
    -- src/lib/packaging.ts for why each level carries its own base value rather
    -- than a factor to its parent). GLOBAL per product, like product_flags — a
    -- different supplier means a different Odoo product, so one product has one
    -- chain. The base unit itself is implicit (to_base = 1) and is never a row.
    CREATE TABLE IF NOT EXISTS product_packaging_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      to_base REAL NOT NULL,
      countable INTEGER NOT NULL DEFAULT 1,     -- may staff enter a number here?
      allow_partial INTEGER NOT NULL DEFAULT 0, -- a sealed pack is whole-only
      barcode TEXT,                             -- scanning a case means CASE
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT,
      updated_by INTEGER,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_packaging_levels (
      session_id INTEGER NOT NULL,
      level_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      to_base REAL NOT NULL,
      countable INTEGER NOT NULL DEFAULT 1,
      allow_partial INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, level_id)
    );
    CREATE INDEX IF NOT EXISTS idx_spl_session ON session_packaging_levels(session_id, odoo_product_id);

    CREATE INDEX IF NOT EXISTS idx_ppl_product ON product_packaging_levels(odoo_product_id, active);
    -- Two live levels of a product may not share a name ("box" twice is a typo,
    -- and the count screen would show two identical steppers). Archived rows are
    -- exempt so a name can be retired and reused.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ppl_name_live
      ON product_packaging_levels(odoo_product_id, name) WHERE active = 1;
  `);
  } catch (e) {
    console.error('[krawings_inventory] table/index init error (continuing to migrate):', e instanceof Error ? e.message : e);
  }
  migrateInventorySchema(db);
}

// ===
// PRODUCT DRAFTS (scan-to-create tracking)
// ===
// A product is considered a "pending draft awaiting manager review" only if
// it was created via the portal's scan-to-count flow AND is still inactive in
// Odoo. Without this table, barcode-lookup would mistake any archived-with-
// barcode product for a draft.

export function registerDraftProduct(odooProductId: number, barcode: string, createdBy: number) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO product_drafts (odoo_product_id, barcode, created_by, created_at)
    VALUES (?, ?, ?, ?)
  `).run(odooProductId, barcode, createdBy, now());
}

/**
 * Products the portal created as drafts. They are INACTIVE in Odoo by design,
 * so any query that hides inactive products has to let these back through —
 * otherwise scanning an unknown barcode creates a product nobody can then find.
 */
export function listDraftProductIds(): number[] {
  const db = getDb();
  const rows = db.prepare("SELECT odoo_product_id FROM product_drafts WHERE status = 'pending'")
    .all() as { odoo_product_id: number }[];
  return rows.map((r) => r.odoo_product_id);
}

export function isDraftProduct(odooProductId: number): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM product_drafts WHERE odoo_product_id = ? AND status = 'pending'`).get(odooProductId);
  return !!row;
}

/** Mark a draft resolved so it stops surfacing as a pending scan. */
export function markDraftStatus(odooProductId: number, status: 'rejected' | 'linked' | 'approved'): void {
  const db = getDb();
  db.prepare(`UPDATE product_drafts SET status = ? WHERE odoo_product_id = ?`).run(status, odooProductId);
}

function now(): string {
  return new Date().toISOString();
}

export function todayStr(): string {
  // Berlin day boundary so it matches restaurant local time (see berlin-date.ts)
  return berlinToday();
}

// ===
// SCHEMA MIGRATIONS
// ===

function migrateInventorySchema(db: ReturnType<typeof getDb>) {
  // Packaging levels are created here as well as in the big schema block above,
  // because that block is ONE db.exec whose errors are deliberately swallowed:
  // a legacy-incompatible statement earlier in it would skip everything after,
  // and both packaging endpoints would then fail with "no such table".
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_packaging_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      to_base REAL NOT NULL,
      countable INTEGER NOT NULL DEFAULT 1,
      allow_partial INTEGER NOT NULL DEFAULT 0,
      barcode TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT,
      updated_by INTEGER,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_packaging_levels (
      session_id INTEGER NOT NULL,
      level_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      to_base REAL NOT NULL,
      countable INTEGER NOT NULL DEFAULT 1,
      allow_partial INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, level_id)
    );
    CREATE INDEX IF NOT EXISTS idx_spl_session ON session_packaging_levels(session_id, odoo_product_id);

    CREATE INDEX IF NOT EXISTS idx_ppl_product ON product_packaging_levels(odoo_product_id, active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ppl_name_live
      ON product_packaging_levels(odoo_product_id, name) WHERE active = 1;
  `);

  // Sessions migrations
  const sessCols = db.prepare("PRAGMA table_info('counting_sessions')").all() as { name: string }[];
  const sessColNames = sessCols.map(c => c.name);
  if (!sessColNames.includes('proof_photo')) {
    // Kept for history: the whole-count "shelf photo" requirement was retired,
    // but photos already taken stay readable.
    db.exec("ALTER TABLE counting_sessions ADD COLUMN proof_photo TEXT");
  }
  // What staff want the manager to know about the WHOLE count ("basement was
  // locked") — distinct from review_note, which is the manager's own reply.
  if (!sessColNames.includes('staff_note')) {
    db.exec("ALTER TABLE counting_sessions ADD COLUMN staff_note TEXT");
  }

  // Template migrations
  const tmplCols = db.prepare("PRAGMA table_info('counting_templates')").all() as { name: string }[];
  const tmplColNames = tmplCols.map(c => c.name);
  if (!tmplColNames.includes('schedule_days')) {
    db.exec("ALTER TABLE counting_templates ADD COLUMN schedule_days TEXT NOT NULL DEFAULT '[]'");
  }
  // Which restaurant a list belongs to — lets a shared department tablet (one
  // company-scoped staff account) see lists that aren't assigned to a specific
  // person. Nullable: legacy lists stay person-only until re-saved.
  if (!tmplColNames.includes('company_id')) {
    db.exec("ALTER TABLE counting_templates ADD COLUMN company_id INTEGER");
  }
  // Ad-hoc lists: the single date (YYYY-MM-DD) the list generates a count on.
  // Nullable; only meaningful when frequency='adhoc'. Legacy ad-hoc lists stay
  // null (never auto-generate) until re-saved with a date.
  if (!tmplColNames.includes('adhoc_date')) {
    db.exec("ALTER TABLE counting_templates ADD COLUMN adhoc_date TEXT");
  }

  // One session per (template, day) — enforced at the DB so concurrent
  // generators (cron + a session-list load) can never double-insert. Fail-open:
  // if historical duplicates exist the index is skipped (never delete data in a
  // migration); it will be created on a later boot once they're cleaned up.
  const dupes = db.prepare(`
    SELECT template_id, scheduled_date, COUNT(*) AS n FROM counting_sessions
    GROUP BY template_id, scheduled_date HAVING n > 1
  `).all();
  if (dupes.length === 0) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_template_date ON counting_sessions(template_id, scheduled_date)');
  } else {
    console.warn(`[inventory] skipped unique (template_id, scheduled_date) index — ${dupes.length} duplicate pair(s) need manual cleanup first`);
  }

  // Snapshot the company onto each session at creation, so later editing a
  // template's company can never re-tag historical sessions' visibility/routing.
  const sessCols2 = db.prepare("PRAGMA table_info('counting_sessions')").all() as { name: string }[];
  if (!sessCols2.some(c => c.name === 'company_id')) {
    db.exec("ALTER TABLE counting_sessions ADD COLUMN company_id INTEGER");
    // Backfill existing sessions from their template's current company.
    db.exec(`
      UPDATE counting_sessions
      SET company_id = (SELECT t.company_id FROM counting_templates t WHERE t.id = counting_sessions.template_id)
      WHERE company_id IS NULL
    `);
  }

  // Crate/multi-UoM migrations — portal-side crate size + count-line split.
  // All additive & nullable: existing rows keep working (missing = no crate).
  // A manager's line correction must NOT overwrite what staff wrote in `notes`.
  const ceCols2 = db.prepare("PRAGMA table_info('count_entries')").all() as { name: string }[];
  if (!ceCols2.some((c) => c.name === 'manager_note')) {
    db.exec("ALTER TABLE count_entries ADD COLUMN manager_note TEXT");
  }

  const pfCols = db.prepare("PRAGMA table_info('product_flags')").all() as { name: string }[];
  if (!pfCols.some(c => c.name === 'units_per_crate')) {
    db.exec("ALTER TABLE product_flags ADD COLUMN units_per_crate REAL");
  }
  if (!pfCols.some(c => c.name === 'pack_label')) {
    // The word staff count in: 'crate', 'bunch', 'piece', 'tray'… (null = 'pack').
    db.exec("ALTER TABLE product_flags ADD COLUMN pack_label TEXT");
  }
  if (!pfCols.some(c => c.name === 'level_shape')) {
    // Container-level counting: which drawing staff mark the open container's
    // level on — 'round' | 'rect' | 'barrel' | 'bottle'. NULL = feature off
    // for this product (manager opt-in, Ethan's explicit call).
    db.exec("ALTER TABLE product_flags ADD COLUMN level_shape TEXT");
  }
  for (const table of ['count_entries', 'quick_counts']) {
    const cols = (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('crate_qty')) db.exec(`ALTER TABLE ${table} ADD COLUMN crate_qty REAL`);
    if (!cols.includes('loose_qty')) db.exec(`ALTER TABLE ${table} ADD COLUMN loose_qty REAL`);
    if (!cols.includes('units_per_crate')) db.exec(`ALTER TABLE ${table} ADD COLUMN units_per_crate REAL`);
  }

  // quick_counts company ownership — nullable: a synchronous SQLite migration
  // can't derive the company from the Odoo location, so it's stamped on new
  // counts and lazily backfilled from Odoo for legacy rows. Un-backfilled
  // (null-company) rows stay quarantined — hidden from non-admin review and
  // approvable only by an unrestricted admin.
  const qcCols = (db.prepare("PRAGMA table_info('quick_counts')").all() as { name: string }[]).map(c => c.name);
  if (!qcCols.includes('company_id')) {
    try { db.exec('ALTER TABLE quick_counts ADD COLUMN company_id INTEGER'); }
    catch (e) { if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e; }
  }
  // Index created HERE — after the column is guaranteed to exist for both fresh
  // and migrated databases. Never in the CREATE-TABLE block, which on a legacy DB
  // runs before this ALTER (a CREATE TABLE IF NOT EXISTS won't add the column).
  db.exec('CREATE INDEX IF NOT EXISTS idx_quick_company ON quick_counts(company_id)');

  // product_drafts lifecycle status (pending → rejected/linked/approved) so a
  // resolved draft stops surfacing as a pending scan.
  const pdCols = (db.prepare("PRAGMA table_info('product_drafts')").all() as { name: string }[]).map(c => c.name);
  if (!pdCols.includes('status')) {
    try { db.exec("ALTER TABLE product_drafts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); }
    catch (e) { if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e; }
  }

  // ===
  // Location-counting redesign (2026-07-19): multi-spot counting, out-of-stock
  // vs not-counted, explicit pack/loose count mode. All additive &
  // nullable/defaulted — legacy rows and open sessions keep working (a missing
  // value = legacy single-location / inferred behaviour).
  // ===

  // product_flags: explicit count mode + the single-unit ("loose") word.
  const pfCols2 = (db.prepare("PRAGMA table_info('product_flags')").all() as { name: string }[]).map(c => c.name);
  if (!pfCols2.includes('count_mode')) db.exec("ALTER TABLE product_flags ADD COLUMN count_mode TEXT");   // 'simple' | 'pack_loose' (null = legacy infer)
  if (!pfCols2.includes('loose_label')) db.exec("ALTER TABLE product_flags ADD COLUMN loose_label TEXT"); // e.g. 'bottles'

  // count_entries: spot identity, out-of-stock, unit snapshots, converted Odoo qty.
  const ceCols = (db.prepare("PRAGMA table_info('count_entries')").all() as { name: string }[]).map(c => c.name);
  if (!ceCols.includes('count_location_id')) db.exec("ALTER TABLE count_entries ADD COLUMN count_location_id INTEGER NOT NULL DEFAULT 0");
  if (!ceCols.includes('out_of_stock')) db.exec("ALTER TABLE count_entries ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0");
  // "Couldn't find it" — an ANSWER, but not a number and NOT a zero.
  // out_of_stock means "I looked, there is none", and approval writes 0 to
  // Odoo for it. If the jar is really sitting in another fridge, that zero is a
  // lie about your stock. This says "acknowledged, quantity unknown" and is
  // deliberately excluded from the stock write.
  if (!ceCols.includes('not_found')) db.exec("ALTER TABLE count_entries ADD COLUMN not_found INTEGER NOT NULL DEFAULT 0");
  if (!ceCols.includes('count_mode')) db.exec("ALTER TABLE count_entries ADD COLUMN count_mode TEXT");
  if (!ceCols.includes('pack_label')) db.exec("ALTER TABLE count_entries ADD COLUMN pack_label TEXT");
  if (!ceCols.includes('loose_label')) db.exec("ALTER TABLE count_entries ADD COLUMN loose_label TEXT");
  // What was entered at each level of a nested chain, as {"levelId": qty}. The
  // base total in counted_qty is what stock reads; this records how a person
  // arrived at it — "2 boxes + 1 pack + 4 loose" — so a manager reviewing the
  // count sees what the counter saw, not just the multiplied-out number.
  if (!ceCols.includes('pack_counts')) db.exec("ALTER TABLE count_entries ADD COLUMN pack_counts TEXT");
  if (!ceCols.includes('odoo_qty')) {
    db.exec("ALTER TABLE count_entries ADD COLUMN odoo_qty REAL");
    // One-time backfill: legacy rows wrote counted_qty to Odoo — preserve that.
    // Guarded by the column-add so future portal-only (null) rows are never clobbered.
    db.exec("UPDATE count_entries SET odoo_qty = counted_qty WHERE odoo_qty IS NULL");
  }

  // quick_counts: out-of-stock + unit snapshots + converted Odoo qty.
  const qc2Cols = (db.prepare("PRAGMA table_info('quick_counts')").all() as { name: string }[]).map(c => c.name);
  if (!qc2Cols.includes('out_of_stock')) db.exec("ALTER TABLE quick_counts ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0");
  if (!qc2Cols.includes('count_mode')) db.exec("ALTER TABLE quick_counts ADD COLUMN count_mode TEXT");
  if (!qc2Cols.includes('pack_label')) db.exec("ALTER TABLE quick_counts ADD COLUMN pack_label TEXT");
  if (!qc2Cols.includes('loose_label')) db.exec("ALTER TABLE quick_counts ADD COLUMN loose_label TEXT");
  if (!qc2Cols.includes('odoo_qty')) {
    db.exec("ALTER TABLE quick_counts ADD COLUMN odoo_qty REAL");
    db.exec("UPDATE quick_counts SET odoo_qty = counted_qty WHERE odoo_qty IS NULL");
  }

  // location_kinds: a per-type emoji so managers can give each CUSTOM type its own
  // icon (shown in the tree, spot picker and printed labels). Additive & defaulted
  // ('📍'), so legacy custom rows keep a sensible pin. Guarded + re-run safe.
  const lkCols = (db.prepare("PRAGMA table_info('location_kinds')").all() as { name: string }[]).map(c => c.name);
  if (!lkCols.includes('icon')) {
    try { db.exec("ALTER TABLE location_kinds ADD COLUMN icon TEXT NOT NULL DEFAULT '📍'"); }
    catch (e) { if (!(e instanceof Error && /duplicate column/i.test(e.message))) throw e; }
  }

  // Per-list placements: a product sits at one or more spots WITHIN a specific
  // list (template). Global product_locations stays for legacy/default physical
  // placement; the builder writes here so editing one list never touches another.
  db.exec(`
    CREATE TABLE IF NOT EXISTS template_product_locations (
      template_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (template_id, odoo_product_id, count_location_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tpl_placements_tpl ON template_product_locations(template_id)');

  // Per-session snapshot of what to count and where, frozen at session creation,
  // so editing a template/placement mid-count never re-routes an open session.
  // Legacy sessions have no rows here and fall back to live template resolution.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_count_items (
      session_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      shelf_sort INTEGER NOT NULL DEFAULT 0,
      requires_photo INTEGER NOT NULL DEFAULT 0,
      count_mode TEXT,
      pack_label TEXT,
      loose_label TEXT,
      units_per_crate REAL,
      PRIMARY KEY (session_id, odoo_product_id, count_location_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_session_items_session ON session_count_items(session_id)');

  // Multi-spot approval SUMS a product's rows — legacy duplicate
  // (session, spot, product) rows would multiply stock. Dedupe (keep the
  // NEWEST row, drop older ones + their photos) so the unique line index can
  // always be enforced.
  const dupRows = db.prepare(`
    SELECT session_id, count_location_id, product_id, COUNT(*) n, MAX(id) keep
    FROM count_entries GROUP BY session_id, count_location_id, product_id HAVING n > 1
  `).all() as { session_id: number; count_location_id: number; product_id: number; keep: number }[];
  if (dupRows.length > 0) {
    const wipeDupes = db.transaction(() => {
      for (const d of dupRows) {
        const olds = db.prepare(
          'SELECT id FROM count_entries WHERE session_id = ? AND count_location_id = ? AND product_id = ? AND id != ?'
        ).all(d.session_id, d.count_location_id, d.product_id, d.keep) as { id: number }[];
        for (const o of olds) {
          db.prepare("DELETE FROM count_photos WHERE source_table = 'count_entries' AND source_id = ?").run(o.id);
          db.prepare('DELETE FROM count_entries WHERE id = ?').run(o.id);
        }
      }
    });
    wipeDupes();
    console.warn(`[inventory] deduped ${dupRows.length} duplicate count line group(s) (kept newest)`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_line ON count_entries(session_id, count_location_id, product_id)');

  // Frozen SPOT metadata per session (name/kind/walk order at freeze time) —
  // renaming, reordering, or archiving a spot in the Locations tree must never
  // rewrite an open session's walk or a historical count's labels.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_count_locations (
      session_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT,
      walk_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, count_location_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_session_locs_session ON session_count_locations(session_id)');

  // MERGED WALK sessions (one combined count per company per day): which real
  // lists fed the walk, with name + frequency FROZEN at creation so later
  // renames can't rewrite what the card said. The session itself belongs to the
  // company's synthetic 'walk' template (frequency='walk', active=0 — never
  // listed, never self-generating); at most one such template per company.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_source_templates (
      session_id INTEGER NOT NULL REFERENCES counting_sessions(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL,
      PRIMARY KEY (session_id, template_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_session_sources_template ON session_source_templates(template_id, session_id)');
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_walk_company ON counting_templates(company_id) WHERE frequency = 'walk'");
  } catch (e) {
    // A database that somehow already holds two 'walk' rows for one company must
    // not fail startup; the merge stays off until an admin resolves it.
    console.warn('[inventory] could not create the one-walk-per-company index', e);
  }

  // One count row per (session, spot, product). Try UNIQUE; if a legacy DB has
  // duplicate (session, product) rows at the default spot 0, fall back to a
  // non-unique index and warn rather than crash startup (app-layer upsert keys
  // on the triple regardless).
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_session_loc_product ON count_entries(session_id, count_location_id, product_id)');
  } catch (e) {
    console.warn('[inventory] duplicate legacy count rows — using non-unique (session,location,product) index', e);
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_session_loc_product ON count_entries(session_id, count_location_id, product_id)');
  }

  // Goods received ("purchased-in") — portal-owned; feeds the opening + received
  // − closing consumption report. No Odoo.
  db.exec(`
    -- WASTE TRACKER — the third term in the consumption equation.
    --
    -- Krawings runs PERIODIC inventory: nobody records taking stock off a shelf,
    -- so consumption is derived, not observed:
    --
    --     opening count + purchases - waste - closing count = what we used
    --
    -- Counts and purchases were already captured. Without waste, every gram
    -- thrown away shows up as something you cooked with, so usage reads high and
    -- nothing says why. This table is that missing term.
    --
    -- Shaped deliberately like stock_receipts above — same columns, same units,
    -- same photo handling — because it is the same kind of event pointing the
    -- other way, and the report adds it as a column beside "received".
    --
    -- RAW STOCK ONLY. Not binned cooked food: when a tray of rice is thrown out
    -- the rice left stock when it was cooked, and recording both subtracts it
    -- twice. Finished-food waste is a separate feature.
    CREATE TABLE IF NOT EXISTS waste_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      department_id INTEGER,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL DEFAULT 0,
      -- qty_base is the ONLY figure the report reads. crate/loose/units_per_crate
      -- record what the person actually typed ("2 bags"), so an entry can be shown
      -- back in the words it was entered in rather than as a converted decimal.
      qty_base REAL NOT NULL,
      crate_qty REAL,
      loose_qty REAL,
      units_per_crate REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      -- Optional by design. A reason you cannot skip is a reason people stop
      -- recording at all, and a quantity with no reason still closes the equation.
      reason TEXT,
      note TEXT,
      photo TEXT,
      -- Who it is credited to, resolved from the PIN on the shared department
      -- tablet — never typed.
      wasted_by INTEGER NOT NULL,
      wasted_at TEXT NOT NULL,
      -- Soft delete, so Undo cannot lose a real entry and the audit trail keeps
      -- the correction. The report ignores voided rows.
      voided_at TEXT,
      voided_by INTEGER,
      -- Idempotency handle minted by the CLIENT per entry. Kitchen wifi is
      -- flaky: an ambiguous retry or a double-tap re-sends the same key and is
      -- answered with the same row instead of a second one.
      client_key TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_waste_company_at ON waste_events(company_id, wasted_at);
    CREATE INDEX IF NOT EXISTS idx_waste_product ON waste_events(odoo_product_id);

    -- Per-department switch: must a waste entry carry a photo? OFF by default ON
    -- PURPOSE — a required photo is the most likely reason someone quietly stops
    -- recording, and that failure is silent. company_id bounds who may flip it.
    CREATE TABLE IF NOT EXISTS waste_settings (
      department_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      photo_required INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      odoo_product_id INTEGER NOT NULL,
      count_location_id INTEGER NOT NULL DEFAULT 0,
      qty_base REAL NOT NULL,
      crate_qty REAL,
      loose_qty REAL,
      units_per_crate REAL,
      uom TEXT NOT NULL DEFAULT 'Units',
      note TEXT,
      photo TEXT,
      received_by INTEGER NOT NULL,
      received_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_company ON stock_receipts(company_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_product ON stock_receipts(odoo_product_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_received_at ON stock_receipts(received_at)');

  // waste_events shipped one commit before client_key existed, so a database
  // that already has the table needs the column added (same pattern as
  // product_flags above). The index is PARTIAL: many rows have no key.
  const weCols = db.prepare("PRAGMA table_info('waste_events')").all() as { name: string }[];
  if (!weCols.some(c => c.name === 'client_key')) {
    db.exec('ALTER TABLE waste_events ADD COLUMN client_key TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_waste_client_key ON waste_events(client_key) WHERE client_key IS NOT NULL');

  // Product pictures (one primary image per product) — portal-owned, set by
  // camera or upload. Keyed by product id (metadata, like product_flags).
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_images (
      odoo_product_id INTEGER PRIMARY KEY,
      image TEXT NOT NULL,
      mime TEXT,
      updated_by INTEGER,
      updated_at TEXT
    )
  `);

  // Yield tests: raw weighed in, pieces counted, usable weighed out. One row per
  // weighing session — the maths that reads them lives in src/lib/yield.ts.
  //
  // Rows are kept FOREVER and never edited, only deleted: an average that can be
  // quietly adjusted is not a measurement. company_id records who weighed it,
  // and the averages pool across companies deliberately — peel is peel, and one
  // restaurant's four tests should not be invisible to the other while both
  // share the product record (and its pack size) already.
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_yield_tests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      odoo_product_id INTEGER NOT NULL,
      company_id      INTEGER NOT NULL,
      raw_qty         REAL NOT NULL,
      pieces          INTEGER,
      usable_qty      REAL NOT NULL,
      note            TEXT,
      created_at      TEXT NOT NULL,
      created_by      INTEGER,
      client_key      TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_yield_product ON product_yield_tests(odoo_product_id)');
  // A retried save on a flaky phone must not become a second measurement — a
  // duplicated test silently drags the average toward whichever batch got sent
  // twice. Same guard as waste_events; partial so old rows without one are fine.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_yield_client_key ON product_yield_tests(client_key) WHERE client_key IS NOT NULL');

  // Does one pack of this product weigh a VARIABLE amount (a bunch of thyme) or
  // a DECLARED one (a 10 kg bucket of ketchup)? Null = nobody has said, and the
  // portal will not offer to overwrite the pack size until somebody has. See the
  // header of src/lib/yield.ts for why the data alone cannot answer this.
  const pfCols3 = (db.prepare("PRAGMA table_info('product_flags')").all() as { name: string }[]).map(c => c.name);
  if (!pfCols3.includes('pack_varies')) db.exec('ALTER TABLE product_flags ADD COLUMN pack_varies INTEGER');

  // ── ONE-TIME data migrations — LAST, so every table above exists ──
  // Flags table created independently too — the big schema exec above is one
  // unit; a legacy-schema failure there must not leave the flag lookups broken.
  db.exec('CREATE TABLE IF NOT EXISTS inventory_migrations (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migApplied = (key: string) => !!db.prepare('SELECT 1 FROM inventory_migrations WHERE key = ?').get(key);
  const markMig = db.prepare('INSERT OR IGNORE INTO inventory_migrations (key, applied_at) VALUES (?, ?)');

  // ONE-TIME: fold per-list spot assignments (template_product_locations) into
  // the products' global HOME SPOTS (product_locations) — the single record the
  // whole module now reads. Copy + flag are one transaction; only spots that
  // still exist are imported; when several lists placed the same product at the
  // same spot, the smallest shelf_sort wins (deterministic). Flag-guarded so a
  // manager's later deliberate spot removal is never resurrected on boot.
  {
    const hasTplTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='template_product_locations'"
    ).get();
    // Flag check INSIDE the transaction — two initializing workers can't both
    // apply (the second sees the flag or its marker INSERT is ignored).
    const tx = db.transaction(() => {
      if (migApplied('tpl_placements_to_home_spots')) return;
      if (hasTplTable) {
        db.exec(`
          INSERT OR IGNORE INTO product_locations (odoo_product_id, count_location_id, shelf_sort)
          SELECT t.odoo_product_id, t.count_location_id, MIN(t.shelf_sort)
          FROM template_product_locations t
          JOIN count_locations cl ON cl.id = t.count_location_id
          WHERE t.count_location_id != 0
          GROUP BY t.odoo_product_id, t.count_location_id
        `);
      }
      markMig.run('tpl_placements_to_home_spots', now());
    });
    tx();
  }

  // ONE-TIME: repair OVERLAPPING home spots — a product homed at BOTH a place
  // and something inside it (e.g. a fridge AND its drawer "D4"). Each placement
  // is its own count line and approval SUMS them, so such a pair silently
  // DOUBLE-COUNTS stock. The picker and setProductsSpotsBulk now refuse to
  // create one, but existing rows (legacy imports, or the old picker that let
  // you tick a unit and its child) still carry them. Same rule as the UI's
  // "keep the most precise places": drop every placement that CONTAINS another
  // placement of the same product. Its own migration key so it also runs on
  // databases where the legacy import already completed.
  {
    const tx = db.transaction(() => {
      if (migApplied('normalize_overlapping_home_spots')) return;
      const parentOfAll = new Map<number, number | null>(
        (db.prepare('SELECT id, parent_id FROM count_locations').all() as { id: number; parent_id: number | null }[])
          .map((r) => [r.id, r.parent_id ?? null] as [number, number | null]),
      );
      // Only ACTIVE placements are candidates. An inactive location never enters
      // a count (session snapshots take active spots only), so treating one as
      // "more precise" could delete a product's real ACTIVE home and strand it in
      // "Everything else". Inactive rows still act as intermediate ancestry links
      // via parentOfAll above.
      const placed = db.prepare(`
        SELECT pl.rowid AS rid, pl.odoo_product_id AS pid, pl.count_location_id AS lid
        FROM product_locations pl
        JOIN count_locations cl ON cl.id = pl.count_location_id
        WHERE cl.active = 1
      `).all() as { rid: number; pid: number; lid: number }[];
      const byProduct = new Map<number, { rid: number; lid: number }[]>();
      placed.forEach((r) => {
        const arr = byProduct.get(r.pid) || [];
        arr.push({ rid: r.rid, lid: r.lid });
        byProduct.set(r.pid, arr);
      });
      const dropRow = db.prepare('DELETE FROM product_locations WHERE rowid = ?');
      byProduct.forEach((rows) => {
        const picked = new Set(rows.map((r) => r.lid));
        const contained = new Set<number>();   // ids that CONTAIN another picked place
        let cyclic = false;
        rows.forEach((r) => {
          const guard = new Set<number>([r.lid]);
          let cur = parentOfAll.get(r.lid) ?? null;
          while (cur != null) {
            if (guard.has(cur)) { cyclic = true; break; }   // malformed parent cycle
            if (picked.has(cur)) contained.add(cur);
            guard.add(cur);
            cur = parentOfAll.get(cur) ?? null;
          }
        });
        // In a cycle there is no meaningful "most precise" place and every member
        // looks like an ancestor of the others — deleting them would strip the
        // product of ALL its home spots. Leave that product untouched instead.
        if (cyclic) return;
        rows.forEach((r) => { if (contained.has(r.lid)) dropRow.run(r.rid); });
      });
      markMig.run('normalize_overlapping_home_spots', now());
    });
    // IMMEDIATE: take the write lock before the marker check, so two workers
    // initializing at once can't both read "not applied" from a deferred snapshot.
    tx.immediate();
  }

  // ONE-TIME: freeze legacy sessions (created before session snapshots existed)
  // as flat spot-0 items. Without this, the guided route would resolve them
  // from LIVE home spots while their count rows sit at spot 0 — editing a home
  // spot could then re-route an old open/reviewable count. Only sessions of
  // explicit-product templates are frozen (category-only lists stay guided:false).
  {
    const tx = db.transaction(() => {
      if (migApplied('freeze_legacy_sessions_flat')) return;
      const legacy = db.prepare(`
        SELECT s.id AS session_id, t.product_ids AS product_ids
        FROM counting_sessions s
        JOIN counting_templates t ON t.id = s.template_id
        WHERE NOT EXISTS (SELECT 1 FROM session_count_items i WHERE i.session_id = s.id)
      `).all() as { session_id: number; product_ids: string }[];
      const ins = db.prepare(`
        INSERT OR IGNORE INTO session_count_items
          (session_id, odoo_product_id, count_location_id, shelf_sort, requires_photo, count_mode, pack_label, loose_label, units_per_crate)
        VALUES (?, ?, 0, ?, 0, NULL, NULL, NULL, NULL)
      `);
      for (const row of legacy) {
        let pids: number[] = [];
        try { pids = JSON.parse(row.product_ids || '[]'); } catch { pids = []; }
        pids.forEach((pid, i) => { if (Number.isInteger(pid) && pid > 0) ins.run(row.session_id, pid, i); });
      }
      markMig.run('freeze_legacy_sessions_flat', now());
    });
    tx();
  }

}

// ===
// SCHEDULE HELPERS
// ===

/**
 * Check if a template should auto-generate a session for today.
 * - daily: always yes
 * - weekly: only if today's weekday is in schedule_days
 * - monthly: not yet implemented (returns false)
 * - adhoc: never auto-generate
 */
function shouldGenerateToday(tmpl: CountingTemplate): boolean {
  if (tmpl.frequency === 'daily') return true;
  if (tmpl.frequency === 'weekly') {
    const dayOfWeek = berlinWeekday(); // Berlin weekday, consistent with todayStr()
    const days = tmpl.schedule_days || [];
    // If no days configured, don't generate (misconfigured template)
    if (days.length === 0) return false;
    return days.includes(dayOfWeek);
  }
  // adhoc: generate only on its chosen date — the daily cron and the session-list
  // load then create it on that Berlin day (once, thanks to the existence check).
  if (tmpl.frequency === 'adhoc') {
    return !!tmpl.adhoc_date && tmpl.adhoc_date === todayStr();
  }
  if (tmpl.frequency === 'monthly') {
    // Fixed day-of-month (Ethan 2026-08-03: fixed days, not rolling intervals).
    // schedule_days[0] holds the day (1-31), CLAMPED to the month's length so
    // "the 31st" still fires in a 30-day month (on the 30th) instead of never.
    const days = Array.isArray(tmpl.schedule_days) ? tmpl.schedule_days : [];
    // Misconfigured (empty, non-numeric, string "31", out of range) → never
    // fire, like weekly. No coercion: a legacy '"31"' must not silently work.
    if (days.length !== 1 || !Number.isInteger(days[0])) return false;
    const dom = days[0] as number;
    if (dom < 1 || dom > 31) return false;
    const [y, m, d] = todayStr().split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d === Math.min(dom, daysInMonth);
  }
  // The synthetic 'walk' container never generates on its own.
  return false;
}

// ===
// TEMPLATES CRUD
// ===

export function createTemplate(data: {
  name: string;
  frequency: Frequency;
  schedule_days?: number[];
  adhoc_date?: string | null;
  location_id: number;
  company_id?: number | null;
  category_ids: number[];
  product_ids?: number[];
  assign_type: AssignType;
  assign_id: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const ts = now();
  const r = db.prepare(`
    INSERT INTO counting_templates (name, frequency, schedule_days, adhoc_date, location_id, company_id, category_ids, product_ids, assign_type, assign_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.name, data.frequency, JSON.stringify(data.schedule_days || []),
    data.adhoc_date ?? null,
    data.location_id, data.company_id ?? null,
    JSON.stringify(data.category_ids), JSON.stringify(data.product_ids || []),
    data.assign_type, data.assign_id, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function updateTemplate(id: number, data: Partial<{
  name: string;
  frequency: Frequency;
  schedule_days: number[];
  adhoc_date: string | null;
  location_id: number;
  company_id: number | null;
  category_ids: number[];
  product_ids: number[];
  assign_type: AssignType;
  assign_id: number | null;
  active: boolean;
}>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.frequency !== undefined) { sets.push('frequency = ?'); vals.push(data.frequency); }
  if (data.schedule_days !== undefined) { sets.push('schedule_days = ?'); vals.push(JSON.stringify(data.schedule_days)); }
  if (data.adhoc_date !== undefined) { sets.push('adhoc_date = ?'); vals.push(data.adhoc_date); }
  if (data.location_id !== undefined) { sets.push('location_id = ?'); vals.push(data.location_id); }
  if (data.company_id !== undefined) { sets.push('company_id = ?'); vals.push(data.company_id); }
  if (data.category_ids !== undefined) { sets.push('category_ids = ?'); vals.push(JSON.stringify(data.category_ids)); }
  if (data.product_ids !== undefined) { sets.push('product_ids = ?'); vals.push(JSON.stringify(data.product_ids)); }
  if (data.assign_type !== undefined) { sets.push('assign_type = ?'); vals.push(data.assign_type); }
  if (data.assign_id !== undefined) { sets.push('assign_id = ?'); vals.push(data.assign_id); }
  if (data.active !== undefined) { sets.push('active = ?'); vals.push(data.active ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE counting_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getTemplate(id: number): CountingTemplate | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, u.name as assign_label
    FROM counting_templates t
    LEFT JOIN portal_users u ON u.id = t.assign_id AND t.assign_type = 'person'
    WHERE t.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? parseTemplate(row) : null;
}

/**
 * Products on this list that ANOTHER active list at the same restaurant already
 * counts — a clash the manager should see BEFORE saving.
 *
 * Ethan's model (2026-08-03): the daily list is produce and perishables, the
 * weekly list is packaging, sauces and slow movers. Overlap between them is
 * normally an accident, and the cost is real: staff walk to the same shelf
 * twice, and the same product ends up with two different answers on the same
 * day (thyme read 0.03 on one list and 0.0 on the other). His rule when they
 * DO clash: the daily list is the one that counts it.
 *
 * Advisory, never a block — a product genuinely wanted on two lists is rare but
 * legitimate, and this is the manager's call to make.
 */
export function templatesClashingProducts(
  companyId: number | null,
  productIds: number[],
  opts: { excludeTemplateId?: number } = {},
): { product_id: number; template_id: number; template_name: string; frequency: string }[] {
  if (companyId == null || productIds.length === 0) return [];
  const wanted = new Set(productIds);
  const out: { product_id: number; template_id: number; template_name: string; frequency: string }[] = [];
  for (const t of listTemplates({ active: true, company_ids: [companyId] })) {
    if (t.id === opts.excludeTemplateId) continue;
    if (t.company_id !== companyId) continue;              // never leak another restaurant's list
    for (const pid of (t.product_ids as number[]) || []) {
      if (wanted.has(pid)) out.push({ product_id: pid, template_id: t.id, template_name: t.name, frequency: t.frequency });
    }
  }
  return out;
}

export function listTemplates(filters?: { location_id?: number; active?: boolean; company_ids?: number[] }): CountingTemplate[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.location_id) { where.push('t.location_id = ?'); vals.push(filters.location_id); }
  if (filters?.active !== undefined) { where.push('t.active = ?'); vals.push(filters.active ? 1 : 0); }
  // Scope to a set of restaurants (for the manager-facing list). Legacy lists
  // with no company stay visible so a manager can re-save to tag them.
  if (filters?.company_ids) {
    if (filters.company_ids.length > 0) {
      const ph = filters.company_ids.map(() => '?').join(',');
      where.push(`(t.company_id IN (${ph}) OR t.company_id IS NULL)`);
      vals.push(...filters.company_ids);
    } else {
      where.push('t.company_id IS NULL');
    }
  }
  // The synthetic per-company 'walk' container is infrastructure, not a list a
  // person manages — it must never surface in Manage Lists, pickers, or the
  // generation loop (it is also active=0; this is the second lock on the door).
  where.push("t.frequency != 'walk'");
  const clause = 'WHERE ' + where.join(' AND ');
  const rows = db.prepare(`
    SELECT t.*, u.name as assign_label
    FROM counting_templates t
    LEFT JOIN portal_users u ON u.id = t.assign_id AND t.assign_type = 'person'
    ${clause}
    ORDER BY t.updated_at DESC
  `).all(...vals) as Record<string, unknown>[];
  return rows.map(parseTemplate);
}

/**
 * Every ACTIVE list of ONE restaurant that contains a product — the set whose
 * today-session could change when that product's home spots change. STRICT
 * company match (excludes NULL-company legacy lists: a spot edit can't affect
 * their own-company snapshot, and counting them would inflate "applied today").
 */
export function templatesForProduct(productId: number, companyId: number): CountingTemplate[] {
  return listTemplates({ company_ids: [companyId], active: true })
    .filter((t) => t.company_id === companyId && t.product_ids.includes(productId));
}

function parseTemplate(row: Record<string, unknown>): CountingTemplate {
  return {
    ...(row as unknown as CountingTemplate),
    category_ids: JSON.parse((row.category_ids as string) || '[]'),
    product_ids: JSON.parse((row.product_ids as string) || '[]'),
    schedule_days: JSON.parse((row.schedule_days as string) || '[]'),
    active: !!row.active,
  };
}

// ===
// SESSIONS CRUD
// ===

export function createSession(data: {
  template_id: number;
  scheduled_date: string;
  location_id: number;
  assigned_user_id?: number | null;
  company_id?: number | null;
}, opts: { recount?: boolean } = {}): number {
  const db = getDb();
  // Snapshot the company at creation; derive from the template when the caller
  // didn't pass it (so the session's company never shifts if the template is
  // later re-tagged).
  const companyId = data.company_id !== undefined
    ? data.company_id
    : (getTemplate(data.template_id)?.company_id ?? null);
  // Session row + its frozen snapshot are ONE transaction: a modern session
  // must never be observable without its snapshot (the count screen, spot
  // validation, review — and a concurrent duplicate-create returning this row
  // as the "winner" — all read it). A freeze failure rolls everything back and
  // surfaces. snapshotSessionFromTemplate's inner transaction nests as a
  // savepoint under better-sqlite3.
  const tx = db.transaction((): number => {
    const r = db.prepare(`
      INSERT INTO counting_sessions (template_id, scheduled_date, location_id, company_id, assigned_user_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(data.template_id, data.scheduled_date, data.location_id, companyId, data.assigned_user_id || null, now());
    const sessionId = r.lastInsertRowid as number;
    snapshotSessionFromTemplate(sessionId, data.template_id, opts);
    const wanted = (getTemplate(data.template_id)?.product_ids as number[]) || [];
    if (wanted.length > 0 && countSessionItems(sessionId) === 0) throw new EmptyCountRefused();
    return sessionId;
  });
  return tx();
}

/**
 * The (at most one) session of a template on a given day — uniqueness is
 * guaranteed by idx_sessions_template_date. Used to make the manual
 * session-create idempotent per (list, day) instead of tripping the index.
 */
export function getSessionByTemplateAndDate(templateId: number, scheduledDate: string): CountingSession | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
  ).get(templateId, scheduledDate) as { id: number } | undefined;
  return row ? getSession(row.id) : null;
}

export function listSessions(filters?: {
  /** One status, or several — 'To count' means pending OR in_progress. */
  status?: SessionStatus | SessionStatus[];
  template_id?: number;
  location_id?: number;
  assigned_user_id?: number;
  scheduled_date?: string;
  // Manager/admin visibility: restrict to these companies (excludes null-company
  // legacy sessions). Omit for an unrestricted admin (no company filter).
  company_ids?: number[];
  // Staff visibility: a session is shown when it's assigned to this user, OR
  // it's not assigned to any person AND belongs to one of the user's companies
  // (how a shared department tablet sees "Anyone"/department lists).
  visibleTo?: { userId: number; companyIds: number[] };
}): CountingSession[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.status) {
    // A started count is 'in_progress', not 'pending'. Matching a single status
    // exactly made an in-progress count vanish from every staff filter, so the
    // person counting could not get back to it. Accept a SET of statuses.
    const wanted = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (wanted.length === 0) { where.push('0 = 1'); }
    else if (wanted.length === 1) { where.push('s.status = ?'); vals.push(wanted[0]); }
    else { where.push(`s.status IN (${wanted.map(() => '?').join(',')})`); vals.push(...wanted); }
  }
  if (filters?.template_id) { where.push('s.template_id = ?'); vals.push(filters.template_id); }
  if (filters?.location_id) { where.push('s.location_id = ?'); vals.push(filters.location_id); }
  if (filters?.assigned_user_id) { where.push('s.assigned_user_id = ?'); vals.push(filters.assigned_user_id); }
  if (filters?.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`s.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  if (filters?.visibleTo) {
    const { userId, companyIds } = filters.visibleTo;
    if (companyIds.length > 0) {
      const ph = companyIds.map(() => '?').join(',');
      where.push(`(s.assigned_user_id = ? OR (s.assigned_user_id IS NULL AND s.company_id IN (${ph})))`);
      vals.push(userId, ...companyIds);
    } else {
      where.push('s.assigned_user_id = ?');
      vals.push(userId);
    }
  }
  if (filters?.scheduled_date) { where.push('s.scheduled_date = ?'); vals.push(filters.scheduled_date); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // Progress comes back with the list. A dashboard that wants to say "41
  // products to count" should not have to open every session to find out, and
  // computing it here means one definition of "counted" rather than one per
  // screen. lines = what this count covers (frozen), done = lines answered.
  return db.prepare(`
    SELECT s.*, t.name as template_name, t.frequency as template_frequency,
           t.product_ids as template_product_ids, t.category_ids as template_category_ids,
           s.company_id as company_id,
           u.name as assigned_user_name,
           (SELECT COUNT(*) FROM session_count_items i WHERE i.session_id = s.id) AS lines_total,
           (SELECT COUNT(*) FROM count_entries e WHERE e.session_id = s.id) AS lines_done,
           (SELECT json_group_array(json_object('template_id', st.template_id, 'name', st.name, 'frequency', st.frequency))
              FROM session_source_templates st WHERE st.session_id = s.id) AS source_templates_json
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    LEFT JOIN portal_users u ON u.id = s.assigned_user_id
    ${clause}
    ORDER BY s.scheduled_date DESC
  `).all(...vals) as CountingSession[];
}

export function getSession(id: number): CountingSession | null {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, t.name as template_name, t.frequency as template_frequency,
           t.product_ids as template_product_ids, t.category_ids as template_category_ids,
           s.company_id as company_id,
           u.name as assigned_user_name,
           (SELECT json_group_array(json_object('template_id', st.template_id, 'name', st.name, 'frequency', st.frequency))
              FROM session_source_templates st WHERE st.session_id = s.id) AS source_templates_json
    FROM counting_sessions s
    LEFT JOIN counting_templates t ON t.id = s.template_id
    LEFT JOIN portal_users u ON u.id = s.assigned_user_id
    WHERE s.id = ?
  `).get(id) as CountingSession | null;
}


export function updateSessionStatus(id: number, status: SessionStatus, extra?: {
  reviewed_by?: number;
  review_note?: string;
  fromStatus?: string | string[];   // when set, only transition from these states (atomic guard)
}): number {
  const db = getDb();
  const ts = now();
  const from = extra?.fromStatus == null ? null : (Array.isArray(extra.fromStatus) ? extra.fromStatus : [extra.fromStatus]);
  const guard = from ? ` AND status IN (${from.map(() => '?').join(',')})` : '';
  const gv = from || [];
  if (status === 'submitted') {
    return db.prepare(`UPDATE counting_sessions SET status = ?, submitted_at = ? WHERE id = ?${guard}`)
      .run(status, ts, id, ...gv).changes as number;
  } else if (status === 'approved' || status === 'rejected') {
    return db.prepare(`UPDATE counting_sessions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?${guard}`)
      .run(status, extra?.reviewed_by || null, ts, extra?.review_note || null, id, ...gv).changes as number;
  } else {
    return db.prepare(`UPDATE counting_sessions SET status = ? WHERE id = ?${guard}`)
      .run(status, id, ...gv).changes as number;
  }
}

/** A lost create-race on the unique (template_id, scheduled_date) index — the
 *  ONLY error the generators may swallow; anything else (disk full, lock,
 *  schema) must surface. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code || '';
  const msg = e instanceof Error ? e.message : '';
  // Exactly a duplicate-key violation — a NOT NULL / FK / CHECK failure is a
  // real bug and must NOT be mistaken for a lost race.
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    || msg.includes('UNIQUE constraint failed');
}

/**
 * Generate counting sessions for today from all active templates.
 * Respects frequency + schedule_days:
 * - daily: generates every day
 * - weekly: only on days listed in schedule_days
 * - adhoc/monthly: skipped (adhoc = manual, monthly = not yet implemented)
 * Skips templates that already have a session for today.
 */
/**
 * The company's synthetic 'walk' container template — the FK anchor for merged
 * daily walk sessions. Hidden everywhere (frequency='walk', active=0, excluded
 * from listTemplates) and unique per company (partial unique index).
 */
export function ensureWalkTemplate(companyId: number): number {
  const db = getDb();
  const pick = () => db.prepare(
    "SELECT id FROM counting_templates WHERE frequency = 'walk' AND company_id = ?",
  ).get(companyId) as { id: number } | undefined;
  const existing = pick();
  if (existing) return existing.id;
  const ts = now();
  try {
    const r = db.prepare(`
      INSERT INTO counting_templates
        (name, frequency, schedule_days, location_id, company_id, category_ids, product_ids, assign_type, assign_id, active, created_by, created_at, updated_at)
      VALUES ('Today''s Count', 'walk', '[]', 0, ?, '[]', '[]', NULL, NULL, 0, 0, ?, ?)
    `).run(companyId, ts, ts);
    return r.lastInsertRowid as number;
  } catch (e) {
    // Lost a create race — the partial unique index guarantees one per company.
    if (!isUniqueViolation(e)) throw e;
    const winner = pick();
    if (!winner) throw e;
    return winner.id;
  }
}

/** Everything a session owns, deleted explicitly (FK cascade is not relied on).
 *  Entries are included even though callers only ever delete UNTOUCHED sessions
 *  — belt and braces, never orphaned rows. */
function deleteSessionArtifacts(sessionId: number): void {
  const db = getDb();
  // Photos hang off the ENTRY rows; drop them before the entries disappear or
  // they are orphaned forever.
  db.prepare(
    "DELETE FROM count_photos WHERE source_table = 'count_entries' AND source_id IN (SELECT id FROM count_entries WHERE session_id = ?)",
  ).run(sessionId);
  db.prepare('DELETE FROM count_entries WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_count_items WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_count_locations WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_packaging_levels WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_location_status WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_source_templates WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM counting_sessions WHERE id = ?').run(sessionId);
}

/**
 * MERGED DAILY WALK — OFF until the double-count invariant is airtight.
 *
 * Combining several due lists into one walk is built and reviewable, but an
 * adversarial review kept finding edge paths where a product could end up in
 * two open counts on the same day (ad-hoc and category lists don't freeze
 * product rows, so they are invisible to the invariant; manual creation and
 * reopen aren't atomic with it). Counting writes the stock ledger, so the
 * merge stays behind this flag until those are closed; with it off, generation
 * behaves EXACTLY as it did before this feature.
 *
 * Enable with INVENTORY_MERGED_WALK=on once the remaining paths are covered.
 * Read at CALL time, not module load, so the setting is honoured on restart
 * without a rebuild (and so tests can exercise both configurations).
 */
export function mergedWalkEnabled(): boolean {
  return process.env.INVENTORY_MERGED_WALK === 'on';
}

/**
 * THE double-count invariant, in one place: which of these products are ALREADY
 * being counted today by another OPEN session of the same restaurant?
 *
 * Two live sessions covering the same product write the same Odoo location
 * twice. Every path that creates a session consults this, so no combination of
 * merged walks, manual creates and mid-day list changes can produce it.
 *
 * SUBMITTED counts do NOT block (Ethan, 2026-08-03): a count waiting for
 * approval is finished as far as the floor is concerned, and starting a fresh
 * count of those products is a deliberate act. Only OPEN counts block.
 */
/**
 * Products of this list that an OPEN count today already covers — the same
 * question as `productsAlreadyCountedToday`, but never switched off.
 *
 * `productsAlreadyCountedToday` is the merged walk's own safety guard and
 * returns nothing when the feature is off. A warning shown to a manager must
 * not depend on a feature flag, so this one always answers. (Codex, 2026-08-03.)
 */
export function openCountClashToday(
  companyId: number | null,
  productIds: number[],
  excludeSessionId?: number,
): number[] {
  if (companyId == null || productIds.length === 0) return [];
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT i.odoo_product_id AS pid
      FROM counting_sessions s
      JOIN session_count_items i ON i.session_id = s.id
     WHERE s.company_id = ? AND s.scheduled_date = ?
       AND s.status IN ('pending','in_progress')
       AND (? IS NULL OR s.id != ?)
  `).all(companyId, todayStr(), excludeSessionId ?? null, excludeSessionId ?? null) as { pid: number }[];
  const live = new Set(rows.map((r) => r.pid));
  return productIds.filter((pid) => live.has(pid));
}

export function productsAlreadyCountedToday(
  companyId: number | null,
  productIds: number[],
  opts: { excludeSessionId?: number; date?: string } = {},
): number[] {
  if (!mergedWalkEnabled()) return [];   // pre-merge behaviour: no such rule
  if (companyId == null || productIds.length === 0) return [];
  const db = getDb();
  const day = opts.date ?? todayStr();
  const rows = db.prepare(`
    SELECT DISTINCT i.odoo_product_id AS pid
      FROM counting_sessions s
      JOIN session_count_items i ON i.session_id = s.id
     WHERE s.company_id = ? AND s.scheduled_date = ?
       AND s.status IN ('pending','in_progress')
       AND (? IS NULL OR s.id != ?)
  `).all(companyId, day, opts.excludeSessionId ?? null, opts.excludeSessionId ?? null) as { pid: number }[];
  const live = new Set(rows.map((r) => r.pid));
  return productIds.filter((pid) => live.has(pid));
}

/** Thrown inside a destructive merge transaction when a session gained work
 *  between the outside check and the write — rolls the whole thing back. */
class MergeAborted extends Error {}

/**
 * Thrown inside a session's creation transaction when its lines froze to
 * NOTHING — every product it wanted is already held by another of today's
 * counts. Rolling back is the only safe outcome: an empty modern snapshot is
 * indistinguishable from a legacy/category session, and those fall back to
 * counting the whole live template — which would re-create the exact duplicate
 * this rule exists to prevent. The prechecks avoid getting here; this makes it
 * impossible even when one of them read a stale template. (Codex, 2026-08-04.)
 */
export class EmptyCountRefused extends Error {}

/** Re-verify INSIDE the transaction that a session is still safe to absorb —
 *  the outside check can go stale under a concurrent writer (another process). */
function assertStillReplaceable(sessionId: number): void {
  const db = getDb();
  const row = db.prepare('SELECT status FROM counting_sessions WHERE id = ?').get(sessionId) as { status: string } | undefined;
  if (!row || row.status !== 'pending' || sessionHasProgress(sessionId)) throw new MergeAborted();
}

/**
 * ONE merged walk session for a company's due lists (Ethan 2026-08-03: one
 * combined walk, one team, per company). Session row + union snapshot + the
 * frozen source-list records are a single transaction — a merged session is
 * never observable half-made. Caller guarantees members.length >= 2, all same
 * company AND same Odoo location, all with explicit product_ids. NOT wrapped in
 * its own outer transaction so callers can compose it with their deletes.
 */
function insertMergedWalkSession(companyId: number, locationId: number, members: CountingTemplate[], scheduledDate: string): number {
  const db = getDb();
  const walkTemplateId = ensureWalkTemplate(companyId);
  const union = Array.from(new Set(members.flatMap((m) => (m.product_ids as number[]) || [])));
  // Who it's for: "one team counts everything" (Ethan 2026-08-03), so a merged
  // walk is normally unassigned — anyone at that restaurant can pick it up. The
  // one exception is when EVERY source list named the same person: dropping
  // their name would silently take the count away from them.
  const assignees = members.map((m) => (m.assign_type === 'person' ? m.assign_id : null));
  const sharedAssignee = assignees.every((a) => a != null && a === assignees[0]) ? assignees[0] : null;
  const r = db.prepare(`
    INSERT INTO counting_sessions (template_id, scheduled_date, location_id, company_id, assigned_user_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(walkTemplateId, scheduledDate, locationId, companyId, sharedAssignee, now());
  const sessionId = r.lastInsertRowid as number;
  snapshotSessionFromProducts(sessionId, union, companyId);
  // Same rule as a solo count: never leave an empty session behind. Reconciliation
  // only checks OPEN counts, but the freeze also yields products to counts already
  // answered today — so the union can come out empty here. (Codex, 2026-08-04.)
  if (union.length > 0 && countSessionItems(sessionId) === 0) throw new MergeAborted();
  const ins = db.prepare('INSERT INTO session_source_templates (session_id, template_id, name, frequency) VALUES (?, ?, ?, ?)');
  for (const m of members) ins.run(sessionId, m.id, m.name, m.frequency);
  return sessionId;
}

/**
 * A list whose product coverage CANNOT be known here: it names categories only,
 * so its products are resolved from Odoo when someone opens it. Nothing in this
 * file can tell whether it overlaps another count, so it is never merged, and
 * its presence blocks merging for that restaurant's day — falling back to the
 * per-list behaviour, which is exactly what happens without the feature.
 */
function hasUnknownCoverage(tmpl: CountingTemplate): boolean {
  const pids = Array.isArray(tmpl.product_ids) ? (tmpl.product_ids as number[]) : [];
  return pids.length === 0;
}

/** A due recurring list that can join the merged walk: it belongs to a company
 *  and names its products explicitly. */
function isMergeable(tmpl: CountingTemplate): boolean {
  return tmpl.company_id != null
    && (tmpl.frequency === 'daily' || tmpl.frequency === 'weekly' || tmpl.frequency === 'monthly')
    && !hasUnknownCoverage(tmpl);
}

/** Any OPEN session for this company/day whose coverage is unknown (a category
 *  or legacy list with no frozen product rows). While one exists, no walk may be
 *  created or rebuilt — it might contain anything. */
function unknownCoverageSessionToday(companyId: number, day: string, ignoreIds: number[] = []): boolean {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id FROM counting_sessions s
     WHERE s.company_id = ? AND s.scheduled_date = ?
       AND s.status IN ('pending','in_progress')
       AND NOT EXISTS (SELECT 1 FROM session_count_items i WHERE i.session_id = s.id)
  `).all(companyId, day) as { id: number }[];
  return rows.some((r) => !ignoreIds.includes(r.id));
}

export function generateTodaySessions(companyIds?: number[]): { created: number; skipped: number } {
  const db = getDb();
  const today = todayStr();

  const templates = listTemplates({ active: true });
  let created = 0;
  let skipped = 0;

  // The old per-template create — used for every non-merged list. One new
  // guard: a list already covered by today's MERGED walk must never get a solo
  // session beside it (that would count its products twice).
  const createSolo = (tmpl: CountingTemplate) => {
    let made = false;
    // Guard AND insert under one write lock: a concurrent generator must not be
    // able to fold this list into a walk between our check and our insert (that
    // would leave a walk and a solo counting the same products).
    const run = db.transaction(() => {
      made = false;
      if (walkSessionForTemplateToday(tmpl.id)) return;
      const existing = db.prepare(
        'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
      ).get(tmpl.id, today);
      if (existing) return;
      // A product another of today's counts already holds is dropped from this
      // one at freeze time, not counted twice (snapshotSessionFromProducts).
      // So the list still opens — unless EVERY product is spoken for, in which
      // case there is nothing here to count and an empty count is just noise.
      if (nothingLeftToCount(tmpl, today)) return;

      let assignedUserId: number | null = null;
      if (tmpl.assign_type === 'person' && tmpl.assign_id) {
        assignedUserId = tmpl.assign_id;
      }
      createSession({
        template_id: tmpl.id,
        scheduled_date: today,
        location_id: tmpl.location_id,
        company_id: tmpl.company_id ?? null,
        assigned_user_id: assignedUserId,
      });
      made = true;
    });
    try {
      run.immediate();
    } catch (e) {
      // Nothing left of its own to count — no session, and nothing is wrong.
      if (e instanceof EmptyCountRefused) { skipped++; return; }
      // Lost a create race — another caller already made today's session.
      // Anything that is NOT the unique-index violation is a real failure.
      if (!isUniqueViolation(e)) throw e;
      skipped++;
      return;
    }
    if (made) created++; else skipped++;
  };

  const soloDue: CountingTemplate[] = [];
  const mergeGroups = new Map<number, CountingTemplate[]>();
  for (const tmpl of templates) {
    // Scope generation to the requester's restaurant(s) when given, so one
    // company's session-list load can't spawn another company's sessions.
    // (undefined = unrestricted, e.g. an admin or an internal call.)
    if (companyIds && !(tmpl.company_id != null && companyIds.includes(tmpl.company_id))) {
      skipped++;
      continue;
    }
    // Check if this template should generate today based on frequency + schedule
    if (!shouldGenerateToday(tmpl)) {
      skipped++;
      continue;
    }
    if (mergedWalkEnabled() && isMergeable(tmpl)) {
      const arr = mergeGroups.get(tmpl.company_id!) || [];
      arr.push(tmpl);
      mergeGroups.set(tmpl.company_id!, arr);
    } else {
      soloDue.push(tmpl);
    }
  }

  // FREEZE THE MOST FREQUENT LIST FIRST. A product on two of today's lists is
  // kept by whichever count freezes it first (see snapshotSessionFromProducts),
  // so the order here decides who keeps the staples — and it should be the list
  // that runs every day, not the weekly deep-count.
  const byCadence = (a: CountingTemplate, b: CountingTemplate) => {
    const rank: Record<string, number> = { daily: 0, weekly: 1, monthly: 2, adhoc: 3 };
    const ra = rank[a.frequency] ?? 99;
    const rb = rank[b.frequency] ?? 99;
    return ra !== rb ? ra - rb : a.id - b.id;
  };
  soloDue.sort(byCadence);

  // Ad-hoc, category-defined and company-less lists: exactly the old behavior.
  for (const tmpl of soloDue) createSolo(tmpl);

  // Recurring product lists, per company: ONE walk when several are due (each
  // location visited once); the plain old path when only one is.
  //
  // Handles the existing-walk case: a list can become due AFTER the walk formed
  // (a manager creates a weekly list at noon), or an earlier fail-closed pass
  // may have left a member a solo session. While the walk AND every member solo
  // are untouched, the whole day is rebuilt as one walk (atomic, re-verified
  // inside the transaction); the moment anything has work in it, today keeps
  // its current layout and only genuinely session-less lists get a solo.
  // ONE company group, decided AND written inside a single IMMEDIATE
  // transaction. SQLite serializes write transactions, so two concurrent
  // generators can never both observe "no walk yet" and each create one (a walk
  // + a solo for the same list would double-count its products). Every check
  // therefore happens under the write lock, and any surprise (work appeared,
  // another walk exists) aborts the whole thing rather than half-applying it.
  const reconcileGroup = (companyId: number, locationId: number, members: CountingTemplate[], canMerge: boolean): void => {
    const walkTemplateId = ensureWalkTemplate(companyId);
    const soloFallback: CountingTemplate[] = [];
    let didCreate = false;

    const run = db.transaction(() => {
      soloFallback.length = 0;
      didCreate = false;
      const existingWalk = db.prepare(
        'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
      ).get(walkTemplateId, today) as { id: number; status: string } | undefined;
      const memberSolos = members
        .map((m) => db.prepare(
          'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
        ).get(m.id, today) as { id: number; status: string } | undefined)
        .filter((s): s is { id: number; status: string } => !!s);

      // #1 + #5, checked under the write lock: a walk may only exist if NOTHING
      // else open that day could hold the same products — neither an unknown-
      // coverage (category/legacy) session nor any other session sharing a
      // product with the union. The sessions we are about to absorb are exempt.
      const absorbIds = [...(existingWalk ? [existingWalk.id] : []), ...memberSolos.map((x) => x.id)];
      const union = Array.from(new Set(members.flatMap((m) => (m.product_ids as number[]) || [])));
      const clashes = union.filter((pid) => {
        const rows = db.prepare(`
          SELECT s.id FROM counting_sessions s
            JOIN session_count_items i ON i.session_id = s.id
           WHERE s.company_id = ? AND s.scheduled_date = ?
             AND s.status IN ('pending','in_progress')
             AND i.odoo_product_id = ?
        `).all(companyId, today, pid) as { id: number }[];
        return rows.some((r) => !absorbIds.includes(r.id));
      });
      const safeToMerge = canMerge
        && clashes.length === 0
        && !unknownCoverageSessionToday(companyId, today, absorbIds);

      if (existingWalk) {
        const untouched = (x: { id: number; status: string }) => x.status === 'pending' && !sessionHasProgress(x.id);
        // The group no longer merges (a source list was deactivated, deleted or
        // rescheduled, the lists now span different Odoo locations, or something
        // else open that day covers these products). An UNTOUCHED walk must be
        // dissolved — leaving it would count products of lists that are no
        // longer due. A started walk is today's count and stays.
        if (!safeToMerge) {
          if (untouched(existingWalk)) {
            deleteSessionArtifacts(existingWalk.id);
            soloFallback.push(...members);
          }
          return;
        }
        const inWalk = new Set(
          (db.prepare('SELECT template_id FROM session_source_templates WHERE session_id = ?')
            .all(existingWalk.id) as { template_id: number }[]).map((r) => r.template_id),
        );
        const staleInWalk = Array.from(inWalk).some((tid) => !members.some((m) => m.id === tid));
        const newcomers = members.filter((m) => !inWalk.has(m.id));
        // Nothing to change only when the walk's membership EXACTLY matches the
        // due set and no stray solos exist.
        if (newcomers.length === 0 && !staleInWalk && memberSolos.length === 0) return;
        if (!untouched(existingWalk) || !memberSolos.every(untouched)) {
          // Fail-closed: counting has started somewhere in this group, so today
          // keeps its shape. Lists with NO session at all still get one — but
          // NEVER one the walk already covers (that is the double-count).
          soloFallback.push(...newcomers);
          return;
        }
        deleteSessionArtifacts(existingWalk.id);
        for (const x of memberSolos) deleteSessionArtifacts(x.id);
        insertMergedWalkSession(companyId, locationId, members, today);
        didCreate = true;
        return;
      }

      // No walk yet.
      if (!safeToMerge) { soloFallback.push(...members); return; }
      // Absorb existing per-list sessions ONLY while untouched; the moment
      // anyone has entered a count or skipped a stop, today keeps its per-list
      // layout (the merge simply starts tomorrow).
      const allUntouched = memberSolos.every((x) => x.status === 'pending' && !sessionHasProgress(x.id));
      if (memberSolos.length > 0 && !allUntouched) {
        soloFallback.push(...members);
        return;
      }
      for (const x of memberSolos) deleteSessionArtifacts(x.id);
      insertMergedWalkSession(companyId, locationId, members, today);
      didCreate = true;
    });

    try {
      run.immediate();
    } catch (e) {
      // Nothing left to merge today (every product is already counted), or the
      // day gained work mid-transaction. Either way the rollback is the answer.
      if (e instanceof MergeAborted) { skipped++; return; }
      if (!isUniqueViolation(e)) throw e;
      // A concurrent generator won the walk row. Its own transaction already
      // reconciled the group; ours rolled back cleanly, so there is nothing to
      // repair here — the next call (or the next member's pass) sees the winner.
      skipped++;
      return;
    }
    if (didCreate) created++;
    // createSolo runs OUTSIDE the group transaction on purpose: it re-checks
    // walk membership itself and each createSession owns its own transaction.
    for (const m of soloFallback) createSolo(m);
  };

  for (const [companyId, members] of Array.from(mergeGroups.entries())) {
    members.sort(byCadence);
    // The walk writes back to ONE Odoo location at approval, so only lists that
    // share it may merge. (In practice one company = one warehouse; a mixed
    // group is a legacy oddity and simply stays per-list.) Either way this goes
    // through reconcileGroup, which also DISSOLVES an untouched walk that no
    // longer has a mergeable group behind it.
    const locationIds = Array.from(new Set(members.map((m) => m.location_id)));
    const canMerge = members.length >= 2 && locationIds.length === 1;
    reconcileGroup(companyId, locationIds[0], members, canMerge);
  }

  // #6: a company can have TODAY'S WALK but no due mergeable lists left (every
  // source was deactivated, rescheduled or deleted). Nothing above iterates it,
  // so an obsolete walk would survive holding products nobody counts today.
  if (mergedWalkEnabled()) {
    const orphanWalks = db.prepare(`
      SELECT s.id, s.status, s.company_id
        FROM counting_sessions s
        JOIN counting_templates t ON t.id = s.template_id
       WHERE t.frequency = 'walk' AND s.scheduled_date = ?
         AND s.status IN ('pending','in_progress')
    `).all(today) as { id: number; status: string; company_id: number | null }[];
    for (const w of orphanWalks) {
      if (w.company_id == null) continue;
      if (companyIds && !companyIds.includes(w.company_id)) continue;
      if (mergeGroups.has(w.company_id)) continue;            // handled above
      // Untouched and nothing due behind it → dissolve. Anything already counted
      // in it stays: it IS the day's count, and a manager reviews it.
      const run = db.transaction(() => {
        const row = db.prepare('SELECT status FROM counting_sessions WHERE id = ?').get(w.id) as { status: string } | undefined;
        if (!row || row.status !== 'pending' || sessionHasProgress(w.id)) return;
        deleteSessionArtifacts(w.id);
      });
      run.immediate();
    }
  }

  return { created, skipped };
}

/**
 * Today's session for a list, MERGE-AWARE — the safe entry point for anything
 * that creates a list and wants it counted today (the templates API), and for
 * manual session creation.
 *
 * If the company already has a merged walk today, this list joins it (rebuild,
 * while the whole group is untouched) instead of getting a session of its own.
 * If the walk has been started, the list gets NO session today — it joins
 * tomorrow's walk. That is deliberate: a second session covering overlapping
 * products would be counted twice into the same Odoo location.
 * Returns { sessionId, joinedWalk, deferred }.
 */
export function ensureTodaySessionForTemplate(
  templateId: number,
  /** false = only resolve the MERGE cases; leave ordinary creation to the caller
   *  (the manual sessions endpoint, which honours its own assigned_user_id). */
  opts: { createIfNoWalk?: boolean } = {},
): { sessionId: number | null; joinedWalk: boolean; deferred: boolean; clash?: number[] } {
  const createIfNoWalk = opts.createIfNoWalk !== false;
  const db = getDb();
  const tmpl = getTemplate(templateId);
  if (!tmpl || !tmpl.active || !shouldGenerateToday(tmpl)) return { sessionId: null, joinedWalk: false, deferred: false };

  const already = walkSessionForTemplateToday(templateId);
  if (already) return { sessionId: already.id, joinedWalk: true, deferred: false };

  // Does a count ALREADY RUNNING today cover some of these products? Creating a
  // second session then puts one product in two open counts — which is how one
  // shelf ended the day with two different answers on 3 Aug (Weekly created at
  // 13:32, mid-service, beside a Daily count already under way).
  //
  // Deliberately NOT productsAlreadyCountedToday: that one is switched off with
  // the merged walk (it is the merge's own guard), and a plain warning to a
  // manager must not silently vanish with a feature flag. (Codex, 2026-08-03.)
  // The template's OWN session is excluded — a repeated create must stay
  // idempotent and return that session, not report a clash with itself.
  const ownToday = db.prepare(
    'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
  ).get(templateId, todayStr()) as { id: number } | undefined;
  const clash = openCountClashToday(tmpl.company_id ?? null, (tmpl.product_ids as number[]) || [], ownToday?.id);

  if (clash.length > 0) {
    // BEFORE deferring, try the good outcome: if nobody has counted anything
    // yet, the whole day can be rebuilt atomically as ONE walk covering both
    // lists — which is exactly what this feature is for. Only a day somebody
    // has already started defers. (Codex spotted that the first version never
    // reached reconciliation and deferred a list that could simply have been
    // merged in.)
    if (mergedWalkEnabled() && isMergeable(tmpl) && tmpl.company_id != null) {
      generateTodaySessions([tmpl.company_id]);
      const joined = walkSessionForTemplateToday(templateId);
      if (joined) return { sessionId: joined.id, joinedWalk: true, deferred: false };
    }
    // This list may ALREADY have today's count (the merge can leave it, or it
    // predates the clash). Nothing is being created, so a clash with some
    // OTHER open session must not hide the session that exists — returning
    // null there would read as "no count today" when there plainly is one.
    // (Codex, 2026-08-03.)
    const own = db.prepare(
      'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
    ).get(templateId, todayStr()) as { id: number } | undefined;
    if (own) return { sessionId: own.id, joinedWalk: false, deferred: false };
    // Overlap alone no longer sends a list away. Its shared products are dropped
    // when it freezes its lines, so it opens today carrying what nobody else
    // holds; only a list with NOTHING of its own left is deferred. The old
    // whole-list deferral is what made a list created mid-service count nothing
    // at all that day. Asked per product AND per Odoo location, so a product
    // open at another stock location can't send this one away. (Codex,
    // 2026-08-04.)
    // Report the SAME products the decision was made on, not a differently
    // scoped set — the manager is told exactly why nothing opened.
    const held = productsFrozenElsewhereToday(
      tmpl.company_id ?? null, tmpl.location_id, todayStr(),
      Array.from(new Set((tmpl.product_ids as number[]) || [])),
      { excludeSessionId: ownToday?.id },
    );
    if (nothingLeftToCount(tmpl, todayStr(), ownToday?.id)) {
      return { sessionId: null, joinedWalk: false, deferred: true, clash: Array.from(held) };
    }
  }

  if (mergedWalkEnabled() && isMergeable(tmpl) && tmpl.company_id != null) {
    const companyId = tmpl.company_id;
    const walkTemplateId = ensureWalkTemplate(companyId);
    const walk = db.prepare(
      'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
    ).get(walkTemplateId, todayStr()) as { id: number; status: string } | undefined;
    if (walk) {
      const walkUntouched = walk.status === 'pending' && !sessionHasProgress(walk.id);
      if (walkUntouched) {
        // Rebuild today's walk from the CURRENT due lists — which now include
        // this one. generateTodaySessions owns the atomic rebuild.
        generateTodaySessions([companyId]);
        const joined = walkSessionForTemplateToday(templateId);
        if (joined) return { sessionId: joined.id, joinedWalk: true, deferred: false };
      }
      // The walk has work in it, so it keeps every product it already holds —
      // a second session freezing those would count them twice into the same
      // Odoo location. Everything ELSE on this list is still countable today,
      // and the freeze drops the overlap by itself; only a list entirely
      // inside the walk has no reason to open. (Codex, 2026-08-04.)
      const walkProductIds = new Set(getSessionItems(walk.id).map((i) => i.odoo_product_id));
      const wantedHere = Array.from(new Set((tmpl.product_ids as number[]) || []));
      const overlapping = wantedHere.filter((pid) => walkProductIds.has(pid));
      if (wantedHere.length > 0 && overlapping.length === wantedHere.length) {
        return { sessionId: null, joinedWalk: false, deferred: true, clash: overlapping };
      }
      return { sessionId: createIfNoWalk ? generateSessionForTemplate(templateId) : null, joinedWalk: false, deferred: false };
    }
  }
  return { sessionId: createIfNoWalk ? generateSessionForTemplate(templateId) : null, joinedWalk: false, deferred: false };
}

/**
 * Manual create, done atomically against the double-count invariant (#2): the
 * overlap check and the insert share one write lock, so two managers (or a
 * manager and the generator) can't both slip a clashing count through.
 * Returns { id } on success, or { clash } listing the products already covered.
 */
export function createSessionGuarded(data: {
  template_id: number;
  scheduled_date: string;
  location_id: number;
  company_id?: number | null;
  assigned_user_id?: number | null;
  product_ids: number[];
}): { id: number | null; existing: boolean; clash: number[] } {
  const db = getDb();
  const run = db.transaction((): { id: number | null; existing: boolean; clash: number[] } => {
    const already = db.prepare(
      'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
    ).get(data.template_id, data.scheduled_date) as { id: number } | undefined;
    if (already) return { id: already.id, existing: true, clash: [] };
    // A HUMAN pressed start, so this is a deliberate count: it may re-ask for a
    // product a FINISHED count already answered today (Ethan, 2026-08-03 — a
    // submitted count is off the floor). What it must never do is collide with a
    // count someone is walking right now, so open counts still hold their
    // products, and a list left with nothing of its own is refused outright.
    // Never flag-gated: a rule that protects the numbers must not switch off.
    const wanted = Array.from(new Set(data.product_ids));
    const taken = productsFrozenElsewhereToday(
      data.company_id ?? null, data.location_id, data.scheduled_date, wanted, { openOnly: true },
    );
    if (wanted.length > 0 && taken.size === wanted.length) {
      return { id: null, existing: false, clash: Array.from(taken) };
    }
    return {
      id: createSession({
        template_id: data.template_id,
        scheduled_date: data.scheduled_date,
        location_id: data.location_id,
        company_id: data.company_id ?? null,
        assigned_user_id: data.assigned_user_id ?? null,
      }, { recount: true }),
      existing: false,
      clash: [],
    };
  });
  try {
    return run.immediate();
  } catch (e) {
    // The template changed under us and nothing was left to freeze.
    if (e instanceof EmptyCountRefused) return { id: null, existing: false, clash: data.product_ids };
    throw e;
  }
}

/**
 * Reopen a rejected count for recount, atomically against the invariant (#3):
 * while it was rejected another count may have picked up its products, and
 * reopening it would put them in two open counts at once.
 * Returns 'ok' | 'not-rejected' | 'clash'.
 */
export function reopenRejectedSessionGuarded(sessionId: number): { result: 'ok' | 'not-rejected' | 'clash'; clash: number[] } {
  const db = getDb();
  const run = db.transaction((): { result: 'ok' | 'not-rejected' | 'clash'; clash: number[] } => {
    const row = db.prepare('SELECT status, company_id, location_id, scheduled_date FROM counting_sessions WHERE id = ?')
      .get(sessionId) as { status: string; company_id: number | null; location_id: number; scheduled_date: string } | undefined;
    if (!row || row.status !== 'rejected') return { result: 'not-rejected', clash: [] };
    const pids = getSessionItems(sessionId).map((i) => i.odoo_product_id);
    // Reopening does NOT re-freeze the lines, so the snapshot-time exclusion
    // can't protect this path: whatever another count picked up while this one
    // sat rejected would genuinely be counted twice. ANY overlap refuses —
    // including a count already submitted or approved, because its number for
    // today exists and recounting into a second row would contradict it. Reject
    // that one first. Never flag-gated (see createSessionGuarded).
    const clash = Array.from(productsFrozenElsewhereToday(
      row.company_id, row.location_id, row.scheduled_date, pids,
      { excludeSessionId: sessionId },
    ));
    if (clash.length > 0) return { result: 'clash', clash };
    const changed = db.prepare(
      "UPDATE counting_sessions SET status = 'pending' WHERE id = ? AND status = 'rejected'",
    ).run(sessionId).changes;
    return changed > 0 ? { result: 'ok', clash: [] } : { result: 'not-rejected', clash: [] };
  });
  return run.immediate();
}

/**
 * Generate a single session for today from a specific template.
 * Respects frequency + schedule_days.
 * Returns the session ID, or null if not scheduled today or already exists.
 */
export function generateSessionForTemplate(templateId: number): number | null {
  const db = getDb();
  const today = todayStr();

  const tmpl = getTemplate(templateId);
  if (!tmpl || !tmpl.active) return null;

  // Check if this template should generate today
  if (!shouldGenerateToday(tmpl)) return null;

  let assignedUserId: number | null = null;
  if (tmpl.assign_type === 'person' && tmpl.assign_id) {
    assignedUserId = tmpl.assign_id;
  }

  try {
    // Walk-membership guard, existence check and insert under ONE write lock —
    // a concurrent generator must not be able to fold this list into a walk
    // between the check and the insert (walk + solo = double count).
    const run = db.transaction((): number => {
      const walk = walkSessionForTemplateToday(templateId);
      if (walk) return walk.id;
      const existing = db.prepare(
        'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
      ).get(templateId, today) as { id: number } | undefined;
      if (existing) return existing.id;
      // Same rule as generateTodaySessions: shared products are dropped at
      // freeze time, and only a list with nothing left of its own is refused.
      if (nothingLeftToCount(tmpl, today)) return -1;
      return createSession({
        template_id: templateId,
        scheduled_date: today,
        location_id: tmpl.location_id,
        company_id: tmpl.company_id ?? null,
        assigned_user_id: assignedUserId,
      });
    });
    const out = run.immediate();
    return out === -1 ? null : out;   // -1 = refused (would double-count today)
  } catch (e) {
    if (e instanceof EmptyCountRefused) return null;
    // Lost a create race (unique index) — return the winner's session instead.
    // Any other failure is real and must surface, not read as "not scheduled".
    if (!isUniqueViolation(e)) throw e;
    const winner = db.prepare(
      'SELECT id FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
    ).get(templateId, today) as { id: number } | undefined;
    if (!winner) throw e;   // constraint error but no competing row — not a race
    return winner.id;
  }
}

/**
 * Remove a template's generated-but-untouched sessions that no longer match its
 * (new) ad-hoc date — so moving a one-off list's date can't leave an orphaned
 * count behind AND spawn a second one. Only sessions that are still 'pending'
 * with ZERO count entries are removed; anything staff started stays.
 * keepDate null = no date survives (e.g. the list stopped being ad-hoc).
 */
/**
 * Hard-delete a counting list (template) and EVERYTHING under it — its sessions
 * and every session's count rows, plus the list's legacy per-list placements.
 * One transaction: all or nothing. Global product↔spot home spots
 * (product_locations) are NOT touched — they belong to products, not this list.
 * Irreversible; the caller confirms + authorizes company access first.
 */
export function deleteTemplate(templateId: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const sessions = (db.prepare('SELECT id FROM counting_sessions WHERE template_id = ?')
      .all(templateId) as { id: number }[]).map((r) => r.id);
    const delPhoto = db.prepare("DELETE FROM count_photos WHERE source_table = 'count_entries' AND source_id = ?");
    for (const sid of sessions) {
      // Count photos hang off entries by a GENERIC (source_table, source_id)
      // association with no FK cascade — delete them BEFORE their entries or
      // they orphan as dead base64 rows.
      const entryIds = (db.prepare('SELECT id FROM count_entries WHERE session_id = ?')
        .all(sid) as { id: number }[]).map((r) => r.id);
      for (const eid of entryIds) delPhoto.run(eid);
      db.prepare('DELETE FROM count_entries WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM session_count_items WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM session_count_locations WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM session_packaging_levels WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM session_location_status WHERE session_id = ?').run(sid);
    }
    db.prepare('DELETE FROM counting_sessions WHERE template_id = ?').run(templateId);
    db.prepare('DELETE FROM template_product_locations WHERE template_id = ?').run(templateId);
    db.prepare('DELETE FROM counting_templates WHERE id = ?').run(templateId);
  });
  tx();
}

/**
 * True when a list has counts worth preserving — any session that isn't an
 * untouched pending one (i.e. submitted/approved/rejected, or a pending session
 * that already has entries). Used to guard hard-delete: a manager may only purge
 * a list with real history if they're an unrestricted admin.
 */
export interface ProductPar { odoo_product_id: number; par_min: number | null; par_max: number | null }

/** Par for these products at ONE restaurant. Missing = no par set, which is fine. */
export function getProductPar(companyId: number, productIds?: number[]): ProductPar[] {
  const db = getDb();
  if (productIds && productIds.length === 0) return [];
  const filter = productIds && productIds.length > 0
    ? ` AND odoo_product_id IN (${productIds.map(() => '?').join(',')})`
    : '';
  return db.prepare(
    `SELECT odoo_product_id, par_min, par_max FROM product_par WHERE company_id = ?${filter}`,
  ).all(companyId, ...(productIds || [])) as ProductPar[];
}

/**
 * Set or clear par for one product at one restaurant.
 *
 * Both null clears it — a product with no par simply never triggers an ordering
 * suggestion, and nothing on the counting screen changes for it. A max below
 * the min is refused rather than stored: "order up to less than you already
 * wanted" is not a thing, and silently swapping them would hide a typo.
 */
export function setProductPar(
  productId: number,
  companyId: number,
  parMin: number | null,
  parMax: number | null,
  userId: number,
): void {
  const clean = (v: number | null) =>
    v == null || !Number.isFinite(v) || v < 0 ? null : v;
  const lo = clean(parMin);
  const hi = clean(parMax);
  if (lo != null && hi != null && hi < lo) {
    throw new Error('PAR_INVALID: the most you want cannot be less than the least you want');
  }
  const db = getDb();
  if (lo == null && hi == null) {
    db.prepare('DELETE FROM product_par WHERE odoo_product_id = ? AND company_id = ?')
      .run(productId, companyId);
    return;
  }
  db.prepare(`
    INSERT INTO product_par (odoo_product_id, company_id, par_min, par_max, updated_by, updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(odoo_product_id, company_id) DO UPDATE SET
      par_min = excluded.par_min, par_max = excluded.par_max,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(productId, companyId, lo, hi, userId, now());
}

export function templateHasRealSessions(templateId: number): boolean {
  const db = getDb();
  // UNCHANGED rule ("a real count exists"), asked of BOTH the list's own
  // sessions and any merged walk it fed — a list folded into a walk has no
  // session under its own id, and its counts live in that walk's history.
  const real = `s.status != 'missed'
      AND (s.status != 'pending' OR EXISTS (SELECT 1 FROM count_entries e WHERE e.session_id = s.id))`;
  const own = db.prepare(`
    SELECT 1 FROM counting_sessions s
    WHERE s.template_id = ? AND ${real}
    LIMIT 1
  `).get(templateId);
  if (own) return true;
  return !!db.prepare(`
    SELECT 1 FROM session_source_templates st
      JOIN counting_sessions s ON s.id = st.session_id
     WHERE st.template_id = ? AND ${real}
     LIMIT 1
  `).get(templateId);
}

/**
 * Close yesterday's counts that nobody touched.
 *
 * A new count is generated every morning and an unfinished one never closed, so
 * they accumulated one per day forever — six days in, the dashboard offered 281
 * products to count, which was the same forty products over and over. A stock
 * count is also only meaningful for the day it was taken: nobody can count
 * yesterday's shelf today.
 *
 * ONLY counts with NO ENTRIES AT ALL are closed. If somebody counted even one
 * product and went home, that is their work and a machine does not get to throw
 * it away overnight — those are returned separately so a manager can decide.
 * The same rule deleteStalePendingSessions already follows.
 *
 * Marked 'missed' rather than deleted, so the gap stays visible: a shelf that
 * went uncounted for six days is worth being able to see.
 */
export function expireStaleSessions(today: string, companyIds?: number[]): {
  missed: number[];
  leftAlone: { id: number; scheduled_date: string; entries: number }[];
} {
  const db = getDb();
  const scope = companyIds && companyIds.length > 0
    ? ` AND s.company_id IN (${companyIds.map(() => '?').join(',')})`
    : '';
  const scopeVals = companyIds && companyIds.length > 0 ? companyIds : [];

  const stale = db.prepare(`
    SELECT s.id, s.scheduled_date,
           (SELECT COUNT(*) FROM count_entries e WHERE e.session_id = s.id) AS entries
      FROM counting_sessions s
     WHERE s.scheduled_date < ?
       AND s.status IN ('pending','in_progress')${scope}
     ORDER BY s.scheduled_date
  `).all(today, ...scopeVals) as { id: number; scheduled_date: string; entries: number }[];

  // "Touched" is sessionHasProgress, NOT just count_entries. A spot deliberately
  // skipped with a reason is somebody standing at a shelf deciding something,
  // and this module already treats that as real progress everywhere else. Using
  // a second, narrower definition here would close a guided count that a person
  // had genuinely worked through.
  const untouched = stale.filter((r) => !sessionHasProgress(r.id));
  const leftAlone = stale.filter((r) => sessionHasProgress(r.id));

  const missed: number[] = [];
  if (untouched.length > 0) {
    const tx = db.transaction((ids: number[]) => {
      const upd = db.prepare(
        "UPDATE counting_sessions SET status = 'missed' WHERE id = ? AND status IN ('pending','in_progress')",
      );
      for (const id of ids) {
        // Re-checked inside the transaction: somebody could start counting
        // between the read above and this write, and their first entry must
        // not be closed out from under them.
        if (sessionHasProgress(id)) continue;
        // Report only what REALLY changed. Returning a candidate as "closed"
        // when the guarded update matched nothing made the cron log say it had
        // done something it had not.
        if (upd.run(id).changes > 0) missed.push(id);
      }
    });
    tx(untouched.map((r) => r.id));
  }

  return { missed, leftAlone };
}

export function deleteStalePendingSessions(templateId: number, keepDate: string | null): number {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id FROM counting_sessions s
    WHERE s.template_id = ? AND s.status = 'pending'
      AND (? IS NULL OR s.scheduled_date != ?)
      AND NOT EXISTS (SELECT 1 FROM count_entries e WHERE e.session_id = s.id)
  `).all(templateId, keepDate, keepDate) as { id: number }[];
  let removed = 0;
  const wipe = db.transaction((ids: number[]) => {
    removed = 0;
    for (const id of ids) {
      // Re-check under the write lock, and against the FULL definition of
      // progress (a skipped stop is work too — the candidate query only knows
      // about entered quantities). Anything touched in the meantime is kept.
      const row = db.prepare('SELECT status FROM counting_sessions WHERE id = ?').get(id) as { status: string } | undefined;
      if (!row || row.status !== 'pending' || sessionHasProgress(id)) continue;
      deleteSessionArtifacts(id);
      removed++;
    }
  });
  wipe.immediate(rows.map((r) => r.id));
  return removed;
}

/**
 * "Apply the new spot layout to today": delete today's session ONLY when it is
 * still pending with zero count entries, then regenerate it (fresh snapshot of
 * the current placements). Returns the new session id, or null when today's
 * count was already started/submitted (never destroy staff work) or none is due.
 */
/**
 * Any real staff progress on a session: a product quantity entered, OR a
 * guided-walk stop already marked counted/skipped. The latter lives ONLY in
 * session_location_status — a location can be finished or skipped (with a skip
 * reason) WITHOUT entering any quantity — so checking count_entries alone would
 * wrongly treat that as untouched and wipe it on regenerate.
 */
function sessionHasProgress(sessionId: number): boolean {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM count_entries WHERE session_id = ? LIMIT 1').get(sessionId)) return true;
  return !!db.prepare(
    "SELECT 1 FROM session_location_status WHERE session_id = ? AND status != 'pending' LIMIT 1"
  ).get(sessionId);
}

/**
 * Which of today's open counts may be WALKED together (they are never merged in
 * the database — see src/lib/combined-walk.ts). A group must be safe on all four:
 *
 *  - same restaurant, and same Odoo stock location (approval writes there);
 *  - every count has frozen product rows (a category list's contents are only
 *    known when it is opened, so it can't be reasoned about here);
 *  - and no PRODUCT appears in more than one of them. Not "product+spot":
 *    approval writes one quantity per product per Odoo location, so the same
 *    product counted in two counts collides there even at different spots.
 *
 * That last rule is what makes the whole thing safe: every line then has exactly
 * ONE owning count, so walking them together is purely a matter of order — each
 * number is written exactly where it would have been anyway.
 *
 * Anything that doesn't qualify is simply returned on its own, which is the
 * per-list behaviour staff have today.
 */
export function walkableGroupsToday(sessionIds: number[]): number[][] {
  const db = getDb();
  if (sessionIds.length === 0) return [];
  const rows = sessionIds.map((id) => db.prepare(
    'SELECT id, company_id, location_id FROM counting_sessions WHERE id = ?',
  ).get(id) as { id: number; company_id: number | null; location_id: number } | undefined)
    .filter((r): r is { id: number; company_id: number | null; location_id: number } => !!r);

  // Lines per count; a count with none (category/legacy) can never share a walk.
  const linesOf = new Map<number, Set<string>>();
  for (const r of rows) {
    const items = getSessionItems(r.id);
    if (items.length > 0) {
      linesOf.set(r.id, new Set(items.map((i) => String(i.odoo_product_id))));
    }
  }

  const byPlace = new Map<string, number[]>();
  const solo: number[][] = [];
  for (const r of rows) {
    if (!linesOf.has(r.id) || r.company_id == null) { solo.push([r.id]); continue; }
    const key = `${r.company_id}:${r.location_id}`;
    byPlace.set(key, [...(byPlace.get(key) || []), r.id]);
  }

  const groups: number[][] = [];
  for (const candidates of Array.from(byPlace.values())) {
    // Greedily grow a group, only admitting a count that shares no line with it.
    const taken = new Set<number>();
    for (const id of candidates) {
      if (taken.has(id)) continue;
      const group = [id];
      const covered = new Set(linesOf.get(id)!);
      taken.add(id);
      for (const other of candidates) {
        if (taken.has(other)) continue;
        const theirs = linesOf.get(other)!;
        let overlaps = false;
        for (const k of Array.from(theirs)) { if (covered.has(k)) { overlaps = true; break; } }
        if (overlaps) continue;
        theirs.forEach((k) => covered.add(k));
        group.push(other);
        taken.add(other);
      }
      groups.push(group);
    }
  }
  return [...groups, ...solo];
}

/** The merged walk session (today) that this real list was folded into, if any. */
export function walkSessionForTemplateToday(templateId: number): { id: number; status: string; company_id: number | null } | null {
  // Flag off = full rollback: walks are neither created NOR consulted, so
  // turning the feature off restores the per-list behaviour completely.
  if (!mergedWalkEnabled()) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id, s.status, s.company_id
    FROM counting_sessions s
    JOIN session_source_templates st ON st.session_id = s.id
    WHERE st.template_id = ? AND s.scheduled_date = ?
  `).get(templateId, todayStr()) as { id: number; status: string; company_id: number | null } | undefined;
  return row ?? null;
}

/** Today's session id when it is still safe to replace: pending, with NO staff
 *  progress (no entered quantities AND no counted/skipped stops). When the list
 *  was folded into a merged walk, that walk IS today's session for it. */
export function untouchedTodaySessionId(templateId: number): number | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
  ).get(templateId, todayStr()) as { id: number; status: string } | undefined;
  const target = row ?? walkSessionForTemplateToday(templateId);
  if (!target || target.status !== 'pending') return null;
  return sessionHasProgress(target.id) ? null : target.id;
}

export function regenerateTodaySession(templateId: number): number | null {
  const db = getDb();
  const today = todayStr();

  // SAFETY GATE — never delete today's session unless we can rebuild it. If the
  // list is gone, inactive, or (schedule drift) no longer due today,
  // generateSessionForTemplate would refuse to recreate it, so deleting first
  // would leave today with NO count at all. Bail out without touching anything.
  const tmpl = getTemplate(templateId);
  if (!tmpl || !tmpl.active || !shouldGenerateToday(tmpl)) return null;

  const existing = db.prepare(
    'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
  ).get(templateId, today) as { id: number; status: string } | undefined;

  // The list may live inside today's MERGED walk instead of its own session —
  // then the walk is what gets rebuilt (fresh union of the CURRENT due lists),
  // under the same untouched-only + atomic rules. Member solo sessions (left by
  // an earlier fail-closed pass) are absorbed too, or their products would be
  // counted twice; if any of them has work in it, nothing is touched.
  if (!existing) {
    const walk = walkSessionForTemplateToday(templateId);
    if (walk) {
      if (walk.status !== 'pending' || sessionHasProgress(walk.id)) return null;
      if (walk.company_id == null) return null;   // walks are always company-scoped; anything else is corrupt
      const companyId = walk.company_id;
      const members = listTemplates({ active: true })
        .filter((t) => t.company_id === companyId && shouldGenerateToday(t) && isMergeable(t));
      if (members.length === 0) return null;      // nothing due any more — keep the walk rather than strand today
      const locationIds = Array.from(new Set(members.map((t) => t.location_id)));
      if (locationIds.length !== 1) return null;  // mixed Odoo locations can't merge — leave today alone
      const memberSolos = members
        .map((m) => db.prepare(
          'SELECT id, status FROM counting_sessions WHERE template_id = ? AND scheduled_date = ?'
        ).get(m.id, today) as { id: number; status: string } | undefined)
        .filter((s): s is { id: number; status: string } => !!s);
      if (!memberSolos.every((s) => s.status === 'pending' && !sessionHasProgress(s.id))) return null;
      try {
        const swapWalk = db.transaction((): number => {
          assertStillReplaceable(walk.id);
          for (const s of memberSolos) assertStillReplaceable(s.id);
          deleteSessionArtifacts(walk.id);
          for (const s of memberSolos) deleteSessionArtifacts(s.id);
          if (members.length === 1) {
            const sid = generateSessionForTemplate(members[0].id);
            if (sid == null) {
              // "Nothing left to count" is a legitimate answer, not a failure:
              // another of today's counts holds every product on this list. Abort
              // the rebuild and leave the day exactly as it was, rather than
              // surfacing an error for a day that simply needs no session here.
              if (nothingLeftToCount(members[0], today)) throw new MergeAborted();
              throw new Error(`regenerateTodaySession: could not rebuild solo session for template ${members[0].id}`);
            }
            return sid;
          }
          return insertMergedWalkSession(companyId, locationIds[0], members, today);
        });
        return swapWalk();
      } catch (e) {
        if (e instanceof MergeAborted) return null;   // someone started counting mid-flight — leave everything
        throw e;
      }
    }
  }

  if (existing) {
    // Never destroy work staff already started or submitted — a product quantity
    // entered OR a guided stop already counted/skipped (status-only progress).
    if (existing.status !== 'pending') return null;
    if (sessionHasProgress(existing.id)) return null;
  }

  // Delete + recreate in ONE transaction: if the fresh snapshot/create throws
  // (e.g. a spot deleted mid-flight), the whole thing rolls back and today's
  // untouched session is preserved — it can never be lost to a partial failure.
  try {
    const swap = db.transaction((): number => {
      if (existing) {
        // Re-check under the write lock: someone may have started counting
        // between the check above and this delete.
        assertStillReplaceable(existing.id);
        deleteSessionArtifacts(existing.id);
      }
      const sid = generateSessionForTemplate(templateId);
      if (sid == null) throw new Error(`regenerateTodaySession: could not rebuild session for template ${templateId}`);
      return sid;
    });
    return swap.immediate();
  } catch (e) {
    if (e instanceof MergeAborted) return null;   // work appeared mid-flight — leave it alone
    throw e;
  }
}

/** Staff's note about the WHOLE count (distinct from the manager's review note). */
export function saveSessionStaffNote(id: number, note: string | null): void {
  getDb().prepare('UPDATE counting_sessions SET staff_note = ? WHERE id = ?').run(note, id);
}

// ===
// COUNT ENTRIES
// ===

export function upsertCountEntry(data: {
  session_id: number;
  product_id: number;
  count_location_id?: number;        // which spot (default 0 = no specific spot / legacy)
  counted_qty: number;               // base-unit total (bottles); forced to 0 when out_of_stock
  out_of_stock?: boolean;            // deliberate "none here" (≠ a counted 0, ≠ not-counted)
  not_found?: boolean;               // "couldn't find it" — answered, quantity UNKNOWN, never written to stock
  system_qty?: number | null;
  uom: string;
  notes?: string;                    // staff's own note; undefined = leave as it was
  manager_note?: string | null;      // a reviewer's correction note — kept apart so it never eats the staff note
  counted_by: number;
  crate_qty?: number | null;         // audit trail: crates as entered
  loose_qty?: number | null;         // audit trail: loose base units as entered
  units_per_crate?: number | null;   // snapshot of the crate size at count time
  count_mode?: CountMode | null;     // snapshot of how it was counted
  pack_label?: string | null;        // snapshot
  loose_label?: string | null;       // snapshot
  /** How many at each level of a nested chain, as JSON. undefined = leave alone. */
  pack_counts?: string | null;
  odoo_qty?: number | null;          // converted base qty safe for Odoo; null = portal-only (no average)
}) {
  const db = getDb();
  const locId = data.count_location_id ?? 0;
  const oos = data.out_of_stock ? 1 : 0;
  const nf = data.not_found ? 1 : 0;
  // "Couldn't find it" stores 0 like out-of-stock does, but the FLAG is what
  // matters: approval reads not_found and leaves Odoo alone, where an
  // out-of-stock line writes a real zero.
  const countedQty = oos || nf ? 0 : data.counted_qty;
  // Keyed by (session, spot, product) so the SAME product can be counted at
  // several spots in one session without overwriting itself.
  const existing = db.prepare(
    'SELECT id FROM count_entries WHERE session_id = ? AND count_location_id = ? AND product_id = ?'
  ).get(data.session_id, locId, data.product_id) as { id: number } | undefined;

  const diff = data.system_qty != null ? countedQty - data.system_qty : null;

  // Preserve an existing crate/loose split when a save doesn't carry crate
  // fields (e.g. a photo-only re-save of a crate product). Passing any crate
  // field (even null) is treated as an explicit set/clear.
  const hasCrateData = data.crate_qty !== undefined || data.loose_qty !== undefined || data.units_per_crate !== undefined;
  let crateQty: number | null;
  let looseQty: number | null;
  let upc: number | null;
  if (hasCrateData) {
    crateQty = data.crate_qty ?? null;
    looseQty = data.loose_qty ?? null;
    upc = data.units_per_crate ?? null;
  } else if (existing) {
    const prev = db.prepare('SELECT crate_qty, loose_qty, units_per_crate FROM count_entries WHERE id = ?').get(existing.id) as
      { crate_qty: number | null; loose_qty: number | null; units_per_crate: number | null } | undefined;
    crateQty = prev?.crate_qty ?? null;
    looseQty = prev?.loose_qty ?? null;
    upc = prev?.units_per_crate ?? null;
  } else {
    crateQty = null;
    looseQty = null;
    upc = null;
  }

  const cmode = data.count_mode ?? null;
  const plabel = data.pack_label ?? null;
  const llabel = data.loose_label ?? null;
  // Out = intentional zero for Odoo. Legacy callers (odoo_qty undefined) keep
  // today's behaviour: write the counted qty. A new caller passes null to mean
  // "portal-only, don't touch Odoo kg" (e.g. a simple count with no average).
  const odooQty = oos ? 0 : (data.odoo_qty !== undefined ? data.odoo_qty : countedQty);

  if (existing) {
    // notes / manager_note are only touched when the caller actually supplies
    // one — otherwise nudging a quantity would wipe a note somebody just wrote.
    const setNotes = data.notes !== undefined ? 'notes = ?,' : '';
    const setMgr = data.manager_note !== undefined ? 'manager_note = ?,' : '';
    const setPack = data.pack_counts !== undefined ? 'pack_counts = ?,' : '';
    db.prepare(`
      UPDATE count_entries SET counted_qty = ?, out_of_stock = ?, not_found = ?, system_qty = ?, diff = ?, uom = ?, ${setNotes} ${setMgr} ${setPack}
        crate_qty = ?, loose_qty = ?, units_per_crate = ?, count_mode = ?, pack_label = ?, loose_label = ?, odoo_qty = ?,
        counted_by = ?, counted_at = ?
      WHERE id = ?
    `).run(
      countedQty, oos, nf, data.system_qty ?? null, diff, data.uom,
      ...(data.notes !== undefined ? [data.notes || null] : []),
      ...(data.manager_note !== undefined ? [data.manager_note || null] : []),
      ...(data.pack_counts !== undefined ? [data.pack_counts || null] : []),
      crateQty, looseQty, upc, cmode, plabel, llabel, odooQty, data.counted_by, now(), existing.id,
    );
  } else {
    db.prepare(`
      INSERT INTO count_entries (session_id, product_id, count_location_id, counted_qty, out_of_stock, not_found, system_qty, diff, uom, notes, manager_note,
        crate_qty, loose_qty, units_per_crate, count_mode, pack_label, loose_label, pack_counts, odoo_qty, counted_by, counted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.session_id, data.product_id, locId, countedQty, oos, nf, data.system_qty ?? null, diff, data.uom, data.notes || null, data.manager_note || null,
      crateQty, looseQty, upc, cmode, plabel, llabel, data.pack_counts || null, odooQty, data.counted_by, now());
  }
}

/**
 * Delete count rows. With `count_location_id` → just that spot's row for the
 * product; without it → every spot for that product in the session (legacy
 * behaviour, e.g. removing a product entirely).
 */
export function deleteCountEntry(session_id: number, product_id: number, count_location_id?: number) {
  const db = getDb();
  const where = count_location_id !== undefined
    ? 'session_id = ? AND product_id = ? AND count_location_id = ?'
    : 'session_id = ? AND product_id = ?';
  const params: number[] = count_location_id !== undefined
    ? [session_id, product_id, count_location_id]
    : [session_id, product_id];
  // Find the entry ids first so we can delete their photos
  const rows = db.prepare(`SELECT id FROM count_entries WHERE ${where}`).all(...params) as { id: number }[];
  for (const r of rows) deleteCountPhotos('count_entries', r.id);
  db.prepare(`DELETE FROM count_entries WHERE ${where}`).run(...params);
}

export function getSessionEntries(session_id: number): CountEntry[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM count_entries WHERE session_id = ? ORDER BY counted_at DESC')
    .all(session_id) as Record<string, unknown>[];
  return rows.map(r => ({ ...(r as unknown as CountEntry), out_of_stock: !!r.out_of_stock, not_found: !!r.not_found }));
}

// ===
// QUICK COUNTS
// ===

export function createQuickCount(data: {
  product_id: number;
  location_id: number;
  company_id: number;                // which restaurant — drives review scoping
  counted_qty: number;               // always the base-unit total (bottles)
  uom: string;
  counted_by: number;
  crate_qty?: number | null;
  loose_qty?: number | null;
  units_per_crate?: number | null;
}): number {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO quick_counts (product_id, location_id, company_id, counted_qty, uom, counted_by, status, submitted_at,
      crate_qty, loose_qty, units_per_crate)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(data.product_id, data.location_id, data.company_id, data.counted_qty, data.uom, data.counted_by, now(),
    data.crate_qty ?? null, data.loose_qty ?? null, data.units_per_crate ?? null);
  return r.lastInsertRowid as number;
}

export function listQuickCounts(filters?: { status?: string; counted_by?: number; company_ids?: number[] }): QuickCount[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters?.status) { where.push('q.status = ?'); vals.push(filters.status); }
  if (filters?.counted_by) { where.push('q.counted_by = ?'); vals.push(filters.counted_by); }
  // Company scope: when the caller is restricted to specific companies, only their
  // rows are visible. A NULL company_id (legacy, not yet backfilled) is excluded by
  // `IN`, so it stays quarantined from non-admins. An explicit empty scope yields no
  // rows; an undefined company_ids (unrestricted admin) applies no company filter.
  if (filters?.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`q.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`
    SELECT q.*, u.name as counted_by_name
    FROM quick_counts q
    LEFT JOIN portal_users u ON u.id = q.counted_by
    ${clause}
    ORDER BY q.submitted_at DESC
  `).all(...vals) as QuickCount[];
}

/** Approve a PENDING quick count atomically. Returns rows changed (0 = already decided). */
export function approveQuickCount(id: number, reviewed_by: number): number {
  const db = getDb();
  return db.prepare("UPDATE quick_counts SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(reviewed_by, now(), id).changes as number;
}

/** Reject (discard) a PENDING quick count — never writes to Odoo stock.
 *  Atomic; returns rows changed (0 = already decided). */
export function rejectQuickCount(id: number, reviewed_by: number): number {
  const db = getDb();
  return db.prepare("UPDATE quick_counts SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(reviewed_by, now(), id).changes as number;
}

/** Distinct Odoo location ids of quick counts still missing a company (for lazy backfill). */
export function getQuickCountLocationsMissingCompany(): number[] {
  const db = getDb();
  return (db.prepare('SELECT DISTINCT location_id FROM quick_counts WHERE company_id IS NULL').all() as { location_id: number }[])
    .map(r => r.location_id);
}

/** Stamp `companyId` on legacy quick counts of `locationId` that were missing it. Returns rows changed. */
export function setQuickCountCompanyByLocation(locationId: number, companyId: number): number {
  const db = getDb();
  return db.prepare('UPDATE quick_counts SET company_id = ? WHERE location_id = ? AND company_id IS NULL')
    .run(companyId, locationId).changes as number;
}

/**
 * Reassign every count line (quick_counts + count_entries) that points to
 * `fromProductId` so it points to `toProductId` instead. Used when a
 * manager links a draft product to an existing product during review.
 *
 * Returns the total number of rows changed.
 */
export class LinkConflictError extends Error {
  code = 'LINK_CONFLICT' as const;
  constructor(public readonly where: string[]) {
    super(`Both products have already been counted in the same place: ${where.join(', ')}`);
    this.name = 'LinkConflictError';
  }
}

/**
 * Move a draft's counting work onto the real product it turned out to be.
 *
 * Three things this has to get right, all of which the first version did not:
 *
 * 1. `session_count_items` — THE FROZEN SCOPE. A count records which products it
 *    covers at the moment it starts, and approval refuses any line for a product
 *    outside that list (OFF_LIST_LINES). Moving an entry to the target while
 *    leaving the snapshot naming the draft produced a line that could never be
 *    approved: the count was silently unfinishable.
 *
 * 2. THE UNIQUE LINE INDEX. There is one count line per (session, product, spot).
 *    If the target has already been counted at the same spot in the same count,
 *    a plain UPDATE violates it and throws mid-way. Rather than guess a merge —
 *    summing could double-count the same physical items, keeping one silently
 *    discards a real observation — this REFUSES and names where, because a
 *    wrong number in a stock count is worse than a manager having to look.
 *
 * 3. ATOMICITY. All of it in one transaction, so a failure changes nothing.
 *
 * Returns the number of rows moved.
 */
export function reassignCountsForProduct(fromProductId: number, toProductId: number): number {
  const db = getDb();

  const tx = db.transaction(() => {
    // --- 2. collisions first, before anything is written -------------------
    const clashes = db.prepare(`
      SELECT s.id AS session_id, COALESCE(t.name, 'a count') AS list_name
        FROM count_entries a
        JOIN count_entries b
          ON b.session_id = a.session_id
         AND COALESCE(b.count_location_id, 0) = COALESCE(a.count_location_id, 0)
         AND b.product_id = ?
        JOIN counting_sessions s ON s.id = a.session_id
        LEFT JOIN counting_templates t ON t.id = s.template_id
       WHERE a.product_id = ?
       GROUP BY s.id
    `).all(toProductId, fromProductId) as { session_id: number; list_name: string }[];
    if (clashes.length > 0) {
      throw new LinkConflictError(clashes.map((c) => c.list_name));
    }
    // Quick counts are keyed by LOCATION, not by a session — there is no
    // session_id on that table. Two open quick counts of the same product at the
    // same place is the collision.
    const quickClash = db.prepare(`
      SELECT COUNT(*) n FROM quick_counts a
       WHERE a.product_id = ?
         AND COALESCE(a.status, 'pending') IN ('pending','in_progress')
         AND EXISTS (
           SELECT 1 FROM quick_counts b
            WHERE b.product_id = ?
              AND b.location_id = a.location_id
              AND COALESCE(b.status, 'pending') IN ('pending','in_progress'))
    `).get(fromProductId, toProductId) as { n: number } | undefined;
    if ((quickClash?.n ?? 0) > 0) {
      throw new LinkConflictError(['a quick count in the same place']);
    }

    let changed = 0;
    changed += db.prepare('UPDATE quick_counts SET product_id = ? WHERE product_id = ?')
      .run(toProductId, fromProductId).changes;
    changed += db.prepare('UPDATE count_entries SET product_id = ? WHERE product_id = ?')
      .run(toProductId, fromProductId).changes;

    // --- 1. the frozen scope has to follow the entries ---------------------
    // Keyed on (session, product, SPOT) — that is the table's primary key, and
    // the reason: one product can be in scope at several spots, and each spot is
    // its own count line. Comparing only session+product would treat "already in
    // scope at a different shelf" as a collision and delete the row for the shelf
    // that actually holds the entry, leaving that line off-list and unapprovable.
    db.prepare(`
      UPDATE session_count_items SET odoo_product_id = ?
       WHERE odoo_product_id = ?
         AND NOT EXISTS (SELECT 1 FROM session_count_items x
                          WHERE x.session_id = session_count_items.session_id
                            AND x.count_location_id = session_count_items.count_location_id
                            AND x.odoo_product_id = ?)
    `).run(toProductId, fromProductId, toProductId);
    // Whatever is left is a spot where the target was ALREADY in scope, so the
    // draft's row is redundant — the entry it justified now points at the target,
    // which is already covered there.
    db.prepare('DELETE FROM session_count_items WHERE odoo_product_id = ?').run(fromProductId);

    // The frozen PACKAGING snapshot travels with it, for the same reason: a line
    // counted in crates needs the crate size the count started with.
    try {
      db.prepare(`
        UPDATE session_packaging_levels SET odoo_product_id = ?
         WHERE odoo_product_id = ?
           AND NOT EXISTS (SELECT 1 FROM session_packaging_levels x
                            WHERE x.session_id = session_packaging_levels.session_id
                              AND x.odoo_product_id = ?)
      `).run(toProductId, fromProductId, toProductId);
      db.prepare('DELETE FROM session_packaging_levels WHERE odoo_product_id = ?').run(fromProductId);
    } catch { /* a build without that table */ }

    return changed;
  });

  return tx();
}

/**
 * Delete every count line (quick_counts + count_entries) that points to
 * `productId`. Used when a manager rejects a draft product during review.
 *
 * Returns the total number of rows deleted.
 */
/**
 * Remove a rejected draft product's counts.
 *
 * ONLY from counts that are still open. This used to be an unqualified
 * `DELETE ... WHERE product_id = ?` across the whole table, so rejecting a
 * draft reached into other restaurants' counts and into APPROVED ones — the
 * audit record of a count that had already been signed off and written to
 * stock. A submitted count could also lose the line its completeness gate had
 * just passed on.
 */
export function deleteCountsForProduct(productId: number): number {
  const db = getDb();
  const OPEN = "('pending','in_progress','rejected')";

  const quickRows = db.prepare(
    `SELECT id FROM quick_counts WHERE product_id = ? AND COALESCE(status,'pending') IN ${OPEN}`
  ).all(productId) as { id: number }[];
  for (const r of quickRows) deleteCountPhotos('quick_counts', r.id);

  const entryRows = db.prepare(
    `SELECT e.id FROM count_entries e
       JOIN counting_sessions s ON s.id = e.session_id
      WHERE e.product_id = ? AND s.status IN ${OPEN}`
  ).all(productId) as { id: number }[];
  for (const r of entryRows) deleteCountPhotos('count_entries', r.id);

  let deleted = 0;
  if (quickRows.length > 0) {
    deleted += db.prepare(
      `DELETE FROM quick_counts WHERE id IN (${quickRows.map(() => '?').join(',')})`
    ).run(...quickRows.map((r) => r.id)).changes;
  }
  if (entryRows.length > 0) {
    deleted += db.prepare(
      `DELETE FROM count_entries WHERE id IN (${entryRows.map(() => '?').join(',')})`
    ).run(...entryRows.map((r) => r.id)).changes;
  }
  return deleted;
}

// ===
// PRODUCT FLAGS (per-product counting requirements)
// ===

export type LevelShape = 'round' | 'rect' | 'barrel' | 'bottle';

export interface ProductFlag {
  odoo_product_id: number;
  requires_photo: boolean;
  units_per_crate: number | null;  // base units per counted pack/piece; null = count in base units
  pack_label: string | null;       // what staff count in: 'crate' | 'bunch' | 'piece' | 'tray'… (null → 'pack')
  count_mode: CountMode | null;    // 'simple' | 'pack_loose' — null = infer from units_per_crate
  loose_label: string | null;      // single-unit word for pack_loose mode ('bottles'…)
  level_shape: LevelShape | null;  // container drawing for level marking; null = off
  // Does one pack weigh a VARIABLE amount (a bunch of thyme) or a DECLARED one
  // (a 10 kg bucket)? null = nobody has said, and yield may not touch the size.
  pack_varies: boolean | null;
  updated_by: number | null;
  updated_at: string | null;
}

export function getProductFlags(ids?: number[]): ProductFlag[] {
  const db = getDb();
  let rows: any[];
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT * FROM product_flags WHERE odoo_product_id IN (${placeholders})`
    ).all(...ids);
  } else {
    rows = db.prepare('SELECT * FROM product_flags').all();
  }
  return rows.map(r => ({
    odoo_product_id: r.odoo_product_id,
    requires_photo: !!r.requires_photo,
    units_per_crate: r.units_per_crate != null ? Number(r.units_per_crate) : null,
    pack_label: r.pack_label ?? null,
    count_mode: (r.count_mode as CountMode) ?? null,
    loose_label: r.loose_label ?? null,
    level_shape: (r.level_shape as LevelShape) ?? null,
    // Tri-state, so keep null distinct from false: "nobody has said" is not the
    // same answer as "the pack is exact", and only the second one is a decision.
    pack_varies: r.pack_varies == null ? null : !!r.pack_varies,
    updated_by: r.updated_by,
    updated_at: r.updated_at,
  }));
}

/**
 * Record whether one pack of this product weighs a variable amount. Null puts
 * it back to unasked. See the yield.ts header for why this cannot be inferred.
 */
export function setProductPackVaries(productId: number, varies: boolean | null, userId: number) {
  const db = getDb();
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, pack_varies, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      pack_varies = excluded.pack_varies,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, varies == null ? null : (varies ? 1 : 0), userId, now());
}

/**
 * Set (or clear) which container drawing a product's level is marked on.
 * Upsert leaves every other flag field untouched, like its siblings.
 */
export function setProductLevelShape(
  productId: number,
  shape: LevelShape | null,
  userId: number,
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, level_shape, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      level_shape = excluded.level_shape,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, shape, userId, now());
}

export function setProductFlag(
  productId: number,
  requiresPhoto: boolean,
  userId: number,
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, requires_photo, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      requires_photo = excluded.requires_photo,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, requiresPhoto ? 1 : 0, userId, now());
}

/**
 * Set (or clear) a product's crate size. Pass null to clear it — that product
 * then falls back to counting in base units. Upsert leaves requires_photo
 * untouched (defaults to 0 only when creating a brand-new row).
 */
export function setProductCrateSize(
  productId: number,
  unitsPerCrate: number | null,
  userId: number,
) {
  const db = getDb();
  const size = unitsPerCrate != null && unitsPerCrate > 0 ? unitsPerCrate : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, units_per_crate, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      units_per_crate = excluded.units_per_crate,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, size, userId, now());
}

/**
 * Set a product's explicit count mode + the single-unit ("loose") word.
 * mode = null clears back to legacy inference. Upsert leaves other flag fields
 * (requires_photo, units_per_crate, pack_label) untouched.
 */
export function setProductCountMode(
  productId: number,
  mode: CountMode | null,
  looseLabel: string | null,
  userId: number,
) {
  const db = getDb();
  const loose = looseLabel && looseLabel.trim() ? looseLabel.trim() : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, count_mode, loose_label, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      count_mode = excluded.count_mode,
      loose_label = excluded.loose_label,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, mode, loose, userId, now());
}

// ===
// YIELD TESTS (raw in, pieces, usable out — see src/lib/yield.ts)
// ===

/**
 * Every test for a product, newest first, with the name of whoever weighed it.
 *
 * NOT filtered by company: the averages pool across restaurants on purpose (see
 * the table comment), so a screen that showed only its own tests would print a
 * different number from the one the maths used.
 */
export function getYieldTests(productId: number): YieldTestRow[] {
  const db = getDb();
  return db.prepare(`
    -- Named columns, never SELECT *: client_key is an idempotency token and has
    -- no business leaving the server just because it shares a row.
    SELECT y.id, y.odoo_product_id, y.company_id, y.raw_qty, y.pieces, y.usable_qty, y.note, y.created_at, y.created_by, u.name AS created_by_name
    FROM product_yield_tests y
    LEFT JOIN portal_users u ON u.id = y.created_by
    WHERE y.odoo_product_id = ?
    ORDER BY y.created_at DESC, y.id DESC
  `).all(productId) as YieldTestRow[];
}

export interface YieldTestRow {
  id: number;
  odoo_product_id: number;
  company_id: number;
  raw_qty: number;
  pieces: number | null;
  usable_qty: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
}

/**
 * Record a weighing. A repeated clientKey returns the test already stored
 * instead of adding a second one — a phone that retries a save on a bad
 * connection must not quietly double-weight the average.
 */
export function addYieldTest(t: {
  productId: number;
  companyId: number;
  rawQty: number;
  pieces: number | null;
  usableQty: number;
  note: string | null;
  userId: number;
  clientKey?: string | null;
}): YieldTestRow {
  const db = getDb();
  const byId = db.prepare(`
    SELECT y.id, y.odoo_product_id, y.company_id, y.raw_qty, y.pieces, y.usable_qty, y.note, y.created_at, y.created_by, u.name AS created_by_name
    FROM product_yield_tests y LEFT JOIN portal_users u ON u.id = y.created_by
    WHERE y.id = ?
  `);
  const key = t.clientKey || null;
  const insert = db.prepare(`
    INSERT INTO product_yield_tests
      (odoo_product_id, company_id, raw_qty, pieces, usable_qty, note, created_at, created_by, client_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findByKey = db.prepare('SELECT id FROM product_yield_tests WHERE client_key = ?');

  if (!key) {
    const info = insert.run(t.productId, t.companyId, t.rawQty, t.pieces, t.usableQty, t.note, now(), t.userId, null);
    return byId.get(info.lastInsertRowid as number) as YieldTestRow;
  }
  // INSERT FIRST, then fall back to the existing row. A check-then-insert leaves
  // a window where two concurrent retries both find nothing and both try to
  // write; the unique index stops the duplicate, but one caller gets a 500
  // instead of the test it already saved. Letting the index be the referee and
  // catching the violation has no such window. (Codex, 2026-08-08.)
  try {
    const info = insert.run(t.productId, t.companyId, t.rawQty, t.pieces, t.usableQty, t.note, now(), t.userId, key);
    return byId.get(info.lastInsertRowid as number) as YieldTestRow;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'SQLITE_CONSTRAINT_UNIQUE' && code !== 'SQLITE_CONSTRAINT') throw err;
    const seen = findByKey.get(key) as { id: number } | undefined;
    if (!seen) throw err;                   // a different constraint failed
    return byId.get(seen.id) as YieldTestRow;
  }
}

/**
 * Delete one test. Returns false when it does not exist OR belongs to another
 * restaurant — a manager may remove their own kitchen's mistaken weighing, not
 * somebody else's measurement, even though both feed the same average.
 */
export function deleteYieldTest(testId: number, companyId: number, productId?: number): boolean {
  const db = getDb();
  // The product is matched too when the caller knows it: a route that deletes
  // by id alone would happily remove a test belonging to a DIFFERENT product
  // and then return that other product's (unchanged) list as if it had worked.
  const sql = productId != null
    ? 'DELETE FROM product_yield_tests WHERE id = ? AND company_id = ? AND odoo_product_id = ?'
    : 'DELETE FROM product_yield_tests WHERE id = ? AND company_id = ?';
  const args: number[] = productId != null ? [testId, companyId, productId] : [testId, companyId];
  return db.prepare(sql).run(...args).changes > 0;
}

/**
 * Change a product's pack size AND keep every restaurant's par meaning the same
 * thing, in one transaction.
 *
 * A measure-based product's par is STORED in base units but ENTERED and SHOWN in
 * packs (parEntryFactor, crate-units.ts). So moving 1 bunch from 0.030 kg to
 * 0.026 kg leaves a stored 0.30 kg untouched and silently turns a manager's "10
 * bunches" into "11.5 bunches" on screen. Nobody typed that, and nobody would
 * see it happen. Rescaling holds the pack figure still and moves the base.
 *
 * Pars are per-restaurant while the pack size is one value for everyone, so
 * every company's row moves — the size changed for all of them.
 *
 * Only for the yield path, where the new number arrives from a MEASUREMENT
 * rather than from someone typing it while looking at the screen.
 */
export function applyMeasuredPackSize(
  productId: number,
  from: number | null,
  to: number,
  userId: number,
): { parsRescaled: number; conflict?: true } {
  const db = getDb();
  const tx = db.transaction(() => {
    // COMPARE AND SWAP. `from` was read before the transaction opened, so
    // between the read and here another manager (or another tab) could have
    // changed the pack size. Writing anyway would overwrite their newer number
    // AND rescale every restaurant's par by the wrong divisor — the pars would
    // be silently wrong and nothing would say so. Re-read inside the
    // transaction and refuse if it moved. (Codex, 2026-08-08.)
    const live = db.prepare(
      'SELECT units_per_crate, pack_varies FROM product_flags WHERE odoo_product_id = ?',
    ).get(productId) as { units_per_crate: number | null; pack_varies: number | null } | undefined;
    const liveSize = live?.units_per_crate != null && live.units_per_crate > 0
      ? Number(live.units_per_crate) : null;
    if (liveSize !== (from != null && from > 0 ? from : null)) return -1;   // -1 = conflict
    // The gate lives HERE, not only in the route. A check made before the
    // transaction opens can go stale, and a future caller of this helper would
    // otherwise inherit a way to overwrite a supplier-declared pack weight with
    // a measurement — the exact thing the whole question exists to prevent.
    // (Codex, 2026-08-08. Its own unit tests were bypassing the route's check.)
    if (live?.pack_varies !== 1) return -1;

    setProductCrateSize(productId, to, userId);
    // No previous size means no pack-based par to preserve: the stored base
    // number WAS the entry number, and rescaling it would invent a change.
    if (from == null || !(from > 0)) return 0;
    const rows = db.prepare(
      'SELECT company_id, par_min, par_max FROM product_par WHERE odoo_product_id = ?',
    ).all(productId) as { company_id: number; par_min: number | null; par_max: number | null }[];
    const scale = (v: number | null) =>
      v == null || !Number.isFinite(v) ? null : roundQtyLocal((v / from) * to);
    let n = 0;
    for (const r of rows) {
      const lo = scale(r.par_min);
      const hi = scale(r.par_max);
      if (lo == null && hi == null) continue;
      db.prepare(
        'UPDATE product_par SET par_min = ?, par_max = ?, updated_by = ?, updated_at = ? '
        + 'WHERE odoo_product_id = ? AND company_id = ?',
      ).run(lo, hi, userId, now(), productId, r.company_id);
      n++;
    }
    return n;
  });
  const n = tx();
  return n < 0 ? { parsRescaled: 0, conflict: true } : { parsRescaled: n };
}

/** Same rounding as crate-units.roundQty — kept local so this file has no cycle. */
function roundQtyLocal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 1e6) / 1e6;
}

/** How many tests each of these products has — for a list badge. */
export function getYieldTestCounts(productIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!productIds.length) return out;
  const db = getDb();
  const rows = db.prepare(`
    SELECT odoo_product_id AS id, COUNT(*) AS n FROM product_yield_tests
    WHERE odoo_product_id IN (${productIds.map(() => '?').join(',')})
    GROUP BY odoo_product_id
  `).all(...productIds) as { id: number; n: number }[];
  for (const r of rows) out.set(r.id, r.n);
  return out;
}

// ===
// TEMPLATE PLACEMENTS (product ↔ spot, scoped to ONE list)
// ===



// ===
// SESSION COUNT ITEMS (frozen "what/where to count" snapshot per session)
// ===

/**
 * A session's FROZEN packaging chains, per product — what the count was taken
 * with, not what the product looks like today. Falls back to nothing when a
 * session predates the snapshot; callers then use the single crate size.
 */
export function getSessionPackagingLevels(sessionId: number): Map<number, PackLevel[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT odoo_product_id, level_id, name, to_base, countable, allow_partial, sort_order
    FROM session_packaging_levels WHERE session_id = ?
    ORDER BY to_base DESC, level_id
  `).all(sessionId) as { odoo_product_id: number; level_id: number; name: string; to_base: number; countable: number; allow_partial: number; sort_order: number }[];
  const out = new Map<number, PackLevel[]>();
  for (const r of rows) {
    const arr = out.get(r.odoo_product_id) || [];
    arr.push({ id: r.level_id, name: r.name, toBase: r.to_base, countable: r.countable === 1, allowPartial: r.allow_partial === 1 });
    out.set(r.odoo_product_id, arr);
  }
  return out;
}

/** Freeze a session's items at creation. Replaces any existing snapshot. */
/** How many lines a session actually froze. */
function countSessionItems(sessionId: number): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM session_count_items WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}

export function snapshotSessionItems(
  sessionId: number,
  items: Omit<SessionCountItem, 'session_id'>[],
): void {
  const db = getDb();
  const tx = db.transaction((rows: typeof items) => {
    db.prepare('DELETE FROM session_count_items WHERE session_id = ?').run(sessionId);
    const ins = db.prepare(`INSERT OR IGNORE INTO session_count_items
      (session_id, odoo_product_id, count_location_id, shelf_sort, requires_photo, count_mode, pack_label, loose_label, units_per_crate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    rows.forEach((it, i) => ins.run(
      sessionId, it.odoo_product_id, it.count_location_id, it.shelf_sort ?? i,
      it.requires_photo ? 1 : 0, it.count_mode ?? null, it.pack_label ?? null,
      it.loose_label ?? null, it.units_per_crate ?? null,
    ));
  });
  tx(items);
}

/**
 * Freeze a session's count items from its template: the template's per-spot
 * placements when present, else the flat product list at the catch-all spot (0)
 * for legacy templates. Captures each product's current unit settings so a later
 * flag/template edit can't change an already-open session.
 */
export function snapshotSessionFromTemplate(
  sessionId: number,
  templateId: number,
  opts: { recount?: boolean } = {},
): void {
  const tmpl = getTemplate(templateId);
  if (!tmpl) return;
  const pids: number[] = Array.isArray(tmpl.product_ids) ? (tmpl.product_ids as number[]) : [];
  snapshotSessionFromProducts(sessionId, pids, tmpl.company_id ?? null, opts);
}

/**
 * Freeze a session's snapshot from an explicit PRODUCT SET — the pure core the
 * per-template path always was, now also fed by the merged daily walk (the
 * deduped union of every due list's products). Same company-scoping, same
 * catch-all rule, same spot/packaging freezing — one implementation.
 */
/**
 * Is this product already part of another of today's counts at the same
 * restaurant AND the same Odoo stock location? Then this count must not freeze
 * it too — the number would exist twice, and approval writes one absolute
 * quantity per product per location.
 *
 * Counts that are finished with (missed, rejected) release their products: a
 * rejected count is going to be recounted, and a missed one never happened.
 */
export function productsFrozenElsewhereToday(
  companyId: number | null,
  locationId: number,
  date: string,
  productIds: number[],
  opts: { excludeSessionId?: number; openOnly?: boolean } = {},
): Set<number> {
  if (companyId == null || productIds.length === 0) return new Set();
  const db = getDb();
  // Two different questions share this query:
  //   default   — "does today's number for this product already exist somewhere?"
  //               A submitted or approved count HAS the number, so it counts.
  //   openOnly  — "is anyone counting this right now?" A submitted count is
  //               finished as far as the floor is concerned (Ethan, 2026-08-03),
  //               so only pending/in_progress block.
  const statuses = opts.openOnly
    ? "'pending','in_progress'"
    : "'pending','in_progress','submitted','approved'";
  const ex = opts.excludeSessionId ?? null;
  const rows = db.prepare(`
    SELECT DISTINCT i.odoo_product_id AS pid
      FROM session_count_items i
      JOIN counting_sessions s ON s.id = i.session_id
     WHERE s.company_id = ? AND s.location_id = ? AND s.scheduled_date = ?
       AND s.status IN (${statuses})
       AND (? IS NULL OR s.id != ?)
  `).all(companyId, locationId, date, ex, ex) as { pid: number }[];
  const held = new Set(rows.map((r) => r.pid));
  return new Set(productIds.filter((pid) => held.has(pid)));
}

/**
 * True when every product on this list is already held by another of today's
 * counts — the one case where opening the list would produce an empty count.
 * A list with anything left of its own still opens (minus the shared items).
 */
function nothingLeftToCount(tmpl: CountingTemplate, date: string, excludeSessionId?: number): boolean {
  const wanted = Array.from(new Set((tmpl.product_ids as number[]) || []));
  if (wanted.length === 0) return false;   // category/legacy list: contents unknown, never refuse
  return productsFrozenElsewhereToday(
    tmpl.company_id ?? null, tmpl.location_id, date, wanted, { excludeSessionId },
  ).size === wanted.length;
}

/** The same question asked from inside a session that already exists. */
function frozenElsewhereFor(sessionId: number, productIds: number[], openOnly = false): Set<number> {
  const db = getDb();
  const me = db.prepare(
    'SELECT company_id, location_id, scheduled_date FROM counting_sessions WHERE id = ?',
  ).get(sessionId) as { company_id: number | null; location_id: number; scheduled_date: string } | undefined;
  if (!me) return new Set();
  return productsFrozenElsewhereToday(
    me.company_id, me.location_id, me.scheduled_date, productIds,
    { excludeSessionId: sessionId, openOnly },
  );
}

export function snapshotSessionFromProducts(
  sessionId: number,
  productIds: number[],
  companyId: number | null,
  opts: { recount?: boolean } = {},
): void {
  // ONE PRODUCT, ONE COUNT PER DAY.
  //
  // A weekly deep-count naturally repeats staples the daily list covers. Rather
  // than reconcile two counts of one product afterwards — which has to be
  // defended at every write, review and report — the duplicate is never created:
  // a product already frozen into another of today's counts (same restaurant,
  // same Odoo stock location) is simply not frozen into this one. Downstream
  // there is nothing special about the day at all.
  //
  // Generation freezes the most frequent list FIRST, so the daily keeps the
  // staples and the weekly is the one that gives them up. Whoever freezes first
  // holds them either way, so the number always exists exactly once.
  const wanted: number[] = Array.from(new Set(productIds));
  const taken = frozenElsewhereFor(sessionId, wanted, opts.recount === true);
  const pids: number[] = wanted.filter((pid) => !taken.has(pid));
  // The walking route comes from the products' GLOBAL home spots
  // (product_locations) — the one record all three editing doors write.
  // (template_product_locations is retired; its rows were folded in by the
  // one-time migration.) The validSpots filter below still scopes to THIS
  // restaurant's spots, so a product's spots in another company are ignored.
  // Home spots are GLOBAL, so a product may also live at ANOTHER restaurant's
  // spots. Those must be dropped BEFORE the placed/unplaced split — a foreign
  // placement converted to the catch-all would create a hidden duplicate
  // "General" line next to the product's real local line. After filtering, a
  // product with no valid local spot gets exactly ONE catch-all line.
  const validSpots = new Set<number>(
    companyId != null ? listCountLocations(companyId).map((l) => l.id) : [],
  );
  const placements = getPlacementsForProducts(pids)
    .filter((p) => pids.includes(p.odoo_product_id) && validSpots.has(p.count_location_id));
  const pairs: { product_id: number; spot: number; shelf: number }[] = [];
  placements.forEach((p, i) => {
    pairs.push({ product_id: p.odoo_product_id, spot: p.count_location_id, shelf: p.shelf_sort ?? i });
  });
  // A product on the list but placed nowhere locally still gets counted — one
  // line at the catch-all spot (0), never silently dropped.
  pids.forEach((pid, i) => {
    if (!pairs.some((q) => q.product_id === pid)) pairs.push({ product_id: pid, spot: 0, shelf: i });
  });
  if (pairs.length === 0) return;

  // Freeze the SPOT metadata (name/kind/walk order) for every real spot used,
  // so later renames/re-orders/archival can't rewrite this session's walk.
  const usedSpots = Array.from(new Set(pairs.map((p) => p.spot).filter((s) => s !== 0)));
  if (usedSpots.length > 0 && companyId != null) {
    const all = listCountLocations(companyId);
    const walk = new Map<number, number>();
    let wi = 0;
    const assign = (nodes: ReturnType<typeof buildLocationTree>) => {
      for (const n of nodes as any[]) { walk.set(n.id, wi++); assign(n.children || []); }
    };
    assign(buildLocationTree(all as any) as any);
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM session_count_locations WHERE session_id = ?').run(sessionId);
      const ins = db.prepare('INSERT OR IGNORE INTO session_count_locations (session_id, count_location_id, name, kind, walk_order) VALUES (?, ?, ?, ?, ?)');
      for (const sid of usedSpots) {
        const loc = all.find((l) => l.id === sid);
        if (loc) ins.run(sessionId, sid, loc.name, loc.kind ?? null, walk.get(sid) ?? loc.sort_order ?? 0);
      }
    });
    tx();
  }
  // Freeze each product's PACKAGING CHAIN too. Without this, editing a box size
  // next month would silently re-convert counts taken last month — invisible, and
  // permanent once this is the ledger. The session keeps the chain it was counted
  // with, exactly as it already keeps the spot names and the crate size.
  {
    const productIds = Array.from(new Set(pairs.map((p) => p.product_id)));
    const chains = listPackagingLevelsFor(productIds);
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM session_packaging_levels WHERE session_id = ?').run(sessionId);
      const ins = db.prepare(`INSERT OR IGNORE INTO session_packaging_levels
        (session_id, level_id, odoo_product_id, name, to_base, countable, allow_partial, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      chains.forEach((levels, pid) => {
        levels.forEach((l) => ins.run(sessionId, l.id, pid, l.name, l.to_base, l.countable, l.allow_partial, l.sort_order));
      });
    });
    tx();
  }

  const flagIds = Array.from(new Set(pairs.map(p => p.product_id)));
  const flagMap = new Map(getProductFlags(flagIds).map(f => [f.odoo_product_id, f]));
  snapshotSessionItems(sessionId, pairs.map(p => {
    const f = flagMap.get(p.product_id);
    return {
      odoo_product_id: p.product_id,
      count_location_id: p.spot,
      shelf_sort: p.shelf,
      requires_photo: !!f?.requires_photo,
      count_mode: f?.count_mode ?? null,
      pack_label: f?.pack_label ?? null,
      loose_label: f?.loose_label ?? null,
      units_per_crate: f?.units_per_crate ?? null,
    };
  }));
}

/** A session's frozen spot metadata (name/kind/walk order at freeze). */
export function getSessionLocations(sessionId: number): { count_location_id: number; name: string; kind: string | null; walk_order: number }[] {
  const db = getDb();
  return db.prepare(
    'SELECT count_location_id, name, kind, walk_order FROM session_count_locations WHERE session_id = ? ORDER BY walk_order, count_location_id',
  ).all(sessionId) as { count_location_id: number; name: string; kind: string | null; walk_order: number }[];
}

/** A session's snapshotted items (empty for legacy sessions → caller falls back to live resolution). */
export function getSessionItems(sessionId: number): SessionCountItem[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM session_count_items WHERE session_id = ? ORDER BY count_location_id, shelf_sort, odoo_product_id',
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(r => ({
    session_id: r.session_id as number,
    odoo_product_id: r.odoo_product_id as number,
    count_location_id: r.count_location_id as number,
    shelf_sort: r.shelf_sort as number,
    requires_photo: !!r.requires_photo,
    count_mode: (r.count_mode as CountMode) ?? null,
    pack_label: (r.pack_label as string) ?? null,
    loose_label: (r.loose_label as string) ?? null,
    units_per_crate: r.units_per_crate != null ? Number(r.units_per_crate) : null,
  }));
}

// ===
// GOODS RECEIVED ("purchased-in") — feeds the consumption report
// ===

export function createReceipt(data: {
  company_id: number; odoo_product_id: number; count_location_id?: number;
  qty_base: number; crate_qty?: number | null; loose_qty?: number | null; units_per_crate?: number | null;
  uom?: string; note?: string | null; photo?: string | null; received_by: number; received_at?: string;
}): number {
  const db = getDb();
  const r = db.prepare(`INSERT INTO stock_receipts
    (company_id, odoo_product_id, count_location_id, qty_base, crate_qty, loose_qty, units_per_crate, uom, note, photo, received_by, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.company_id, data.odoo_product_id, data.count_location_id ?? 0, data.qty_base,
      data.crate_qty ?? null, data.loose_qty ?? null, data.units_per_crate ?? null,
      data.uom || 'Units', data.note ?? null, data.photo ?? null, data.received_by, data.received_at || now());
  return r.lastInsertRowid as number;
}

export function listReceipts(filters: { company_ids?: number[]; product_id?: number; from?: string; to?: string; limit?: number }): StockReceipt[] {
  const db = getDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters.company_ids) {
    if (filters.company_ids.length === 0) where.push('0 = 1');
    else { where.push(`r.company_id IN (${filters.company_ids.map(() => '?').join(',')})`); vals.push(...filters.company_ids); }
  }
  if (filters.product_id) { where.push('r.odoo_product_id = ?'); vals.push(filters.product_id); }
  if (filters.from) { where.push('r.received_at >= ?'); vals.push(filters.from); }
  if (filters.to) { where.push('r.received_at <= ?'); vals.push(filters.to); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // Explicit columns — never ship the base64 photo blob in a bulk list (it can be
  // large × up to 500 rows). Callers fetch a photo individually if needed.
  const rows = db.prepare(`
    SELECT r.id, r.company_id, r.odoo_product_id, r.count_location_id, r.qty_base,
           r.crate_qty, r.loose_qty, r.units_per_crate, r.uom, r.note,
           (r.photo IS NOT NULL) AS has_photo, r.received_by, r.received_at,
           u.name AS received_by_name
    FROM stock_receipts r
    LEFT JOIN portal_users u ON u.id = r.received_by
    ${clause}
    ORDER BY r.received_at DESC
    LIMIT ?
  `).all(...vals, filters.limit ?? 500) as Record<string, unknown>[];
  return rows.map(r => ({ ...(r as unknown as StockReceipt), photo: null, has_photo: !!r.has_photo }));
}

/**
 * Delete a receipt, bounded to the caller's companies (null = unrestricted admin).
 * When `ownerUserId` is given, also require the receipt to be that user's own
 * (non-managers may only remove their own submissions). Returns rows changed.
 */
export function deleteReceipt(id: number, companyIds: number[] | null, ownerUserId?: number): number {
  const db = getDb();
  if (companyIds && companyIds.length === 0) return 0;
  const conds: string[] = ['id = ?'];
  const vals: unknown[] = [id];
  if (companyIds) { conds.push(`company_id IN (${companyIds.map(() => '?').join(',')})`); vals.push(...companyIds); }
  if (ownerUserId !== undefined) { conds.push('received_by = ?'); vals.push(ownerUserId); }
  return db.prepare(`DELETE FROM stock_receipts WHERE ${conds.join(' AND ')}`).run(...vals).changes as number;
}

/**
 * Sum received base qty per product over (from, to] for a company set (usage report).
 * Lower bound is EXCLUSIVE so a delivery already reflected in the opening count
 * isn't added again as "received".
 */
export function sumReceiptsByProduct(companyIds: number[] | null, from: string, to: string): Record<number, number> {
  const db = getDb();
  const where: string[] = ['received_at > ?', 'received_at <= ?'];
  const vals: unknown[] = [from, to];
  if (companyIds) {
    if (companyIds.length === 0) return {};
    where.push(`company_id IN (${companyIds.map(() => '?').join(',')})`);
    vals.push(...companyIds);
  }
  const rows = db.prepare(
    `SELECT odoo_product_id AS pid, SUM(qty_base) AS total FROM stock_receipts WHERE ${where.join(' AND ')} GROUP BY odoo_product_id`,
  ).all(...vals) as { pid: number; total: number }[];
  const out: Record<number, number> = {};
  for (const r of rows) out[r.pid] = Number(r.total) || 0;
  return out;
}

// ===
// PRODUCT PICTURES (one primary image per product)
// ===

export function setProductImage(productId: number, image: string, mime: string | null, userId: number): void {
  const db = getDb();
  db.prepare(`INSERT INTO product_images (odoo_product_id, image, mime, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      image = excluded.image, mime = excluded.mime,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(productId, image, mime, userId, now());
}

export function getProductImage(productId: number): { image: string; mime: string | null } | null {
  const db = getDb();
  const r = db.prepare('SELECT image, mime FROM product_images WHERE odoo_product_id = ?').get(productId) as
    { image: string; mime: string | null } | undefined;
  return r ? { image: r.image, mime: r.mime ?? null } : null;
}

export function deleteProductImage(productId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM product_images WHERE odoo_product_id = ?').run(productId);
}

/** Product ids that have a picture — so a UI shows a thumbnail only where present. */
export function listProductImageIds(): number[] {
  const db = getDb();
  return (db.prepare('SELECT odoo_product_id FROM product_images').all() as { odoo_product_id: number }[])
    .map(r => r.odoo_product_id);
}

/**
 * Set (or clear) the word staff count a product in ('crate' | 'bunch' |
 * 'piece' | 'tray'…). Pass null/'' to clear. Leaves the size + photo flag
 * untouched (defaults on a brand-new row only).
 */
export function setProductPackLabel(
  productId: number,
  packLabel: string | null,
  userId: number,
) {
  const db = getDb();
  const label = packLabel && packLabel.trim() ? packLabel.trim().toLowerCase() : null;
  db.prepare(`
    INSERT INTO product_flags (odoo_product_id, pack_label, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(odoo_product_id) DO UPDATE SET
      pack_label = excluded.pack_label,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(productId, label, userId, now());
}

// ===
// COUNT PHOTOS (per-line photo proof)
// ===

export type PhotoSource = 'count_entries' | 'quick_counts';

/**
 * Replace the full set of photos for a given count line. Deletes any
 * existing photos then inserts the provided set. Pass an empty array
 * to clear photos for a line.
 */
export function setCountPhotos(source: PhotoSource, sourceId: number, photos: string[]) {
  const db = getDb();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
      .run(source, sourceId);
    const insert = db.prepare(
      'INSERT INTO count_photos (source_table, source_id, photo, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const p of photos) insert.run(source, sourceId, p, ts);
  });
  tx();
}

/**
 * Get all photos for a single count line.
 */
export function getCountPhotos(source: PhotoSource, sourceId: number): string[] {
  const db = getDb();
  return (db.prepare(
    'SELECT photo FROM count_photos WHERE source_table = ? AND source_id = ? ORDER BY id'
  ).all(source, sourceId) as { photo: string }[]).map(r => r.photo);
}

/**
 * Bulk fetch: returns { sourceId → string[] } for the given line IDs.
 */
export function getCountPhotosMap(source: PhotoSource, sourceIds: number[]): Record<number, string[]> {
  if (sourceIds.length === 0) return {};
  const db = getDb();
  const placeholders = sourceIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT source_id, photo FROM count_photos WHERE source_table = ? AND source_id IN (${placeholders}) ORDER BY id`
  ).all(source, ...sourceIds) as { source_id: number; photo: string }[];
  const map: Record<number, string[]> = {};
  for (const r of rows) {
    if (!map[r.source_id]) map[r.source_id] = [];
    map[r.source_id].push(r.photo);
  }
  return map;
}

export function deleteCountPhotos(source: PhotoSource, sourceId: number) {
  const db = getDb();
  db.prepare('DELETE FROM count_photos WHERE source_table = ? AND source_id = ?')
    .run(source, sourceId);
}

// ===
// COUNT LOCATIONS (the digital twin — portal-owned, company-scoped)
// ===


/**
 * Kinds this company treats as MARKERS. Read straight from location_kinds so
 * this module never has to import the floorplan layer (which imports this one).
 * 'utility' is the built-in of that shape unless the company said otherwise.
 */
function markerOnlyKindSet(companyId: number): Set<string> {
  const db = getDb();
  const hasCol = (db.prepare('PRAGMA table_info(location_kinds)').all() as { name: string }[])
    .some((c) => c.name === 'marker_only');
  if (!hasCol) return new Set(['utility']);
  const rows = db.prepare('SELECT kind, marker_only FROM location_kinds WHERE company_id = ?')
    .all(companyId) as { kind: string; marker_only: number | null }[];
  const set = new Set(rows.filter((r) => r.marker_only === 1).map((r) => r.kind.toLowerCase()));
  if (rows.find((r) => r.kind === 'utility')?.marker_only !== 0) set.add('utility');
  return set;
}

export function createCountLocation(data: {
  parent_id?: number | null;
  company_id: number;
  name: string;
  kind?: string;
  description?: string | null;
  photo?: string | null;
  odoo_location_id?: number | null;
  created_by: number;
}): number {
  const db = getDb();
  // Nothing nests inside a MARKER — a shut-off valve has no shelves. Checked
  // here rather than per screen, so the floorplan's bulk "add levels", the
  // Locations manager and any direct request all obey the same rule.
  if (data.parent_id != null) {
    const parent = db.prepare('SELECT kind FROM count_locations WHERE id = ?')
      .get(data.parent_id) as { kind: string } | undefined;
    if (parent && markerOnlyKindSet(data.company_id).has((parent.kind || '').toLowerCase())) {
      throw new Error('That place is a marker (a valve, a fuse box) — nothing goes inside it');
    }
  }
  const ts = now();
  // Default sort_order = max sibling + 10 within the same company + parent.
  const sib = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM count_locations
     WHERE company_id = ? AND ${data.parent_id != null ? 'parent_id = ?' : 'parent_id IS NULL'}`
  ).get(...(data.parent_id != null ? [data.company_id, data.parent_id] : [data.company_id])) as { m: number };
  const r = db.prepare(`
    INSERT INTO count_locations (parent_id, company_id, name, kind, description, photo, sort_order, odoo_location_id, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    data.parent_id ?? null, data.company_id, data.name, data.kind || 'area',
    data.description ?? null, data.photo ?? null, sib.m + 10,
    data.odoo_location_id ?? null, data.created_by, ts, ts
  );
  return r.lastInsertRowid as number;
}

export function getCountLocation(id: number): CountLocation | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM count_locations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? { ...(r as unknown as CountLocation), active: !!r.active } : null;
}

/** Update a location. Scoped by company_id so a manager can never edit another company's location by guessing an id. */
export function updateCountLocation(id: number, companyId: number, data: Partial<{
  name: string; kind: string; description: string | null; photo: string | null;
  sort_order: number; odoo_location_id: number | null; parent_id: number | null; active: boolean;
}>): void {
  const db = getDb();
  // Retyping THIS location into a marker is the same act as converting the
  // type — it hides the row from the product picker — so it meets the same
  // refusal: not while it holds products or contains other places.
  if (data.kind !== undefined) {
    const markers = markerOnlyKindSet(companyId);
    if (markers.has((data.kind || '').toLowerCase())) {
      const cur = db.prepare('SELECT kind FROM count_locations WHERE id = ? AND company_id = ?')
        .get(id, companyId) as { kind: string } | undefined;
      const wasMarker = markers.has((cur?.kind || '').toLowerCase());
      if (cur && !wasMarker) {
        const products = (db.prepare('SELECT COUNT(*) n FROM product_locations WHERE count_location_id = ?')
          .get(id) as { n: number }).n;
        const children = (db.prepare('SELECT COUNT(*) n FROM count_locations WHERE parent_id = ? AND active = 1')
          .get(id) as { n: number }).n;
        if (products > 0 || children > 0) {
          throw new Error('That type is a marker — empty this place first (it still has products or things inside it)');
        }
      }
    }
  }
  const sets: string[] = []; const vals: unknown[] = [];
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (data.name !== undefined) put('name', data.name);
  if (data.kind !== undefined) put('kind', data.kind);
  if (data.description !== undefined) put('description', data.description);
  if (data.photo !== undefined) put('photo', data.photo);
  if (data.sort_order !== undefined) put('sort_order', data.sort_order);
  if (data.odoo_location_id !== undefined) put('odoo_location_id', data.odoo_location_id);
  if (data.parent_id !== undefined) put('parent_id', data.parent_id);
  if (data.active !== undefined) put('active', data.active ? 1 : 0);
  if (sets.length === 0) return;
  put('updated_at', now()); vals.push(id, companyId);
  db.prepare(`UPDATE count_locations SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
}

/**
 * Delete a location and everything under it (children + all placements), scoped by company.
 * No FK reliance (SQLite FK enforcement is off by default), so cascade is done manually.
 * NOTE (Phase 2): once session history references locations, switch this to a soft delete
 * (active = 0, already filtered by listCountLocations) so a historical count is never orphaned.
 */
/**
 * Delete a location and everything inside it.
 *
 * Returns EVERY id that went, not just the one asked for. Deleting a room takes
 * its shelves with it, and a list told only about the room keeps rendering
 * children of something that no longer exists.
 */
export function deleteCountLocation(id: number, companyId: number): number[] {
  const db = getDb();
  const ids: number[] = [];
  const seen = new Set<number>();
  const collect = (parent: number) => {
    if (seen.has(parent)) return; // guard against any accidental cycle
    seen.add(parent);
    ids.push(parent);
    const kids = db.prepare('SELECT id FROM count_locations WHERE parent_id = ? AND company_id = ?')
      .all(parent, companyId) as { id: number }[];
    kids.forEach((k) => collect(k.id));
  };
  // Only proceed if the root belongs to this company.
  const root = db.prepare('SELECT id FROM count_locations WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!root) return [];
  collect(id);
  const tx = db.transaction(() => {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM product_locations WHERE count_location_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM count_locations WHERE id IN (${ph}) AND company_id = ?`).run(...ids, companyId);
  });
  tx();
  return ids;
}

export function listCountLocations(companyId: number): CountLocation[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM count_locations WHERE company_id = ? AND active = 1 ORDER BY sort_order, id'
  ).all(companyId) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as CountLocation), active: !!r.active }));
}

export function getCountLocationsByIds(ids: number[]): CountLocation[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM count_locations WHERE id IN (${ph}) AND active = 1`
  ).all(...ids) as Record<string, unknown>[];
  return rows.map((r) => ({ ...(r as unknown as CountLocation), active: !!r.active }));
}

export function getPlacements(countLocationId: number): ProductPlacement[] {
  const db = getDb();
  return db.prepare(
    'SELECT odoo_product_id, count_location_id, shelf_sort FROM product_locations WHERE count_location_id = ? ORDER BY shelf_sort, odoo_product_id'
  ).all(countLocationId) as ProductPlacement[];
}

/**
 * Every placement at a spot AND everything inside it — a fridge's drawers, and
 * their drawers. Labelling "the Countertop fridge" means the products in its
 * drawers too; nobody thinks of a drawer as a separate errand.
 *
 * Ordered by spot then shelf order, so a printed batch comes out grouped by
 * shelf: all of D1's stickers together, then D2's, which is how a person with a
 * roll of labels actually works.
 */
export function getPlacementsInSubtree(rootLocationId: number): ProductPlacement[] {
  const db = getDb();
  return db.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT ?
      UNION
      SELECT l.id FROM count_locations l JOIN tree t ON l.parent_id = t.id
    )
    SELECT p.odoo_product_id, p.count_location_id, p.shelf_sort
      FROM product_locations p
      JOIN tree ON p.count_location_id = tree.id
     ORDER BY p.count_location_id, p.shelf_sort, p.odoo_product_id
  `).all(rootLocationId) as ProductPlacement[];
}

export function getLocationsForProduct(productId: number): number[] {
  const db = getDb();
  return (db.prepare('SELECT count_location_id FROM product_locations WHERE odoo_product_id = ?').all(productId) as { count_location_id: number }[])
    .map((r) => r.count_location_id);
}

/**
 * Every placement across ONE restaurant's active spots — the map a screen needs
 * to show each product's home-spot chips in one query.
 */
export function listPlacementsForCompany(companyId: number): ProductPlacement[] {
  const db = getDb();
  return db.prepare(`
    SELECT pl.odoo_product_id, pl.count_location_id, pl.shelf_sort
    FROM product_locations pl
    JOIN count_locations cl ON cl.id = pl.count_location_id
    WHERE cl.company_id = ? AND cl.active = 1
    ORDER BY pl.count_location_id, pl.shelf_sort, pl.odoo_product_id
  `).all(companyId) as ProductPlacement[];
}

/**
 * Product-first home-spot edit: make `spotIds` the product's spots WITHIN one
 * restaurant. Spots of other companies are untouched. Kept placements keep
 * their shelf order; newly added spots append at the end of that spot's shelf
 * (MAX+10). Caller must have validated that every id belongs to `companyId`.
 */
export function setProductSpots(productId: number, spotIds: number[], companyId: number): void {
  setProductsSpotsBulk(companyId, [{ product_id: productId, spot_ids: spotIds }]);
}

/**
 * Replace several products' home spots within one restaurant in ONE
 * transaction — either every product applies or none does (an "Arrange spots"
 * save must never half-commit). Revalidates every requested spot INSIDE the
 * transaction: a spot deleted mid-flight aborts the whole edit.
 */
export function setProductsSpotsBulk(
  companyId: number,
  entries: { product_id: number; spot_ids: number[] }[],
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const valid = new Set((db.prepare(
      'SELECT id FROM count_locations WHERE company_id = ? AND active = 1'
    ).all(companyId) as { id: number }[]).map((r) => r.id));
    // MARKER INVARIANT (here, so every writer is covered — the product sheet,
    // the spot-first assign, the bulk arranger): a marker type marks a thing,
    // it is not somewhere products live. Hiding the button was never enough;
    // a stale screen or a direct request would still have written the row.
    const markers = markerOnlyKindSet(companyId);
    if (markers.size > 0) {
      const kindOf = db.prepare('SELECT kind FROM count_locations WHERE id = ?');
      const alreadyThere = db.prepare(
        'SELECT count_location_id AS id FROM product_locations WHERE odoo_product_id = ?',
      );
      for (const e of entries) {
        // Only NEW placements are refused. One that already exists (data from
        // before a type became a marker) is carried through untouched —
        // otherwise a screen that cannot even show that row would be unable to
        // save anything at all.
        const existing = new Set((alreadyThere.all(e.product_id) as { id: number }[]).map(r => r.id));
        for (const id of e.spot_ids) {
          if (existing.has(id)) continue;
          const k = (kindOf.get(id) as { kind: string } | undefined)?.kind ?? '';
          if (markers.has(k.toLowerCase())) {
            throw new Error('That place is a marker (a valve, a fuse box) — products are not stored there');
          }
        }
      }
    }
    // OVERLAP INVARIANT (enforced here so EVERY caller is covered — the product
    // sheet, the bulk "arrange spots" writer, anything future): a product may
    // never be homed at both a place and something inside it. Each placement is
    // its own count line and approval SUMS them, so an ancestor+descendant pair
    // silently DOUBLE-COUNTS stock. Parents are read WITHOUT the active filter:
    // a deactivated middle node must not hide an overlap that would reappear the
    // moment it is reactivated.
    // Parents are read across ALL companies (not just `companyId`): a chain that
    // passes through a row of another company would otherwise truncate the walk
    // and hide an overlap. The table is small, and the placement ids themselves
    // are still company-validated above.
    const parentOf = new Map<number, number | null>(
      (db.prepare('SELECT id, parent_id FROM count_locations')
        .all() as { id: number; parent_id: number | null }[])
        .map((r) => [r.id, r.parent_id ?? null] as [number, number | null]),
    );
    const maxSort = db.prepare('SELECT COALESCE(MAX(shelf_sort), 0) AS m FROM product_locations WHERE count_location_id = ?');
    const del = db.prepare('DELETE FROM product_locations WHERE odoo_product_id = ? AND count_location_id = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO product_locations (odoo_product_id, count_location_id, shelf_sort) VALUES (?, ?, ?)');
    const currentOf = db.prepare(`
      SELECT pl.count_location_id FROM product_locations pl
      JOIN count_locations cl ON cl.id = pl.count_location_id
      WHERE pl.odoo_product_id = ? AND cl.company_id = ?
    `);
    for (const e of entries) {
      for (const id of e.spot_ids) {
        if (!valid.has(id)) throw new Error(`Spot ${id} is not an active spot of company ${companyId}`);
      }
      {
        const picked = new Set(e.spot_ids);
        for (const id of e.spot_ids) {
          const guard = new Set<number>([id]);
          let cur = parentOf.get(id) ?? null;
          while (cur != null && !guard.has(cur)) {
            if (picked.has(cur)) {
              throw new Error(`OVERLAPPING_PLACEMENT: product ${e.product_id} would be counted at both ${cur} and ${id} (one is inside the other)`);
            }
            guard.add(cur);
            cur = parentOf.get(cur) ?? null;
          }
        }
      }
      const current = (currentOf.all(e.product_id, companyId) as { count_location_id: number }[])
        .map((r) => r.count_location_id);
      const next = new Set(e.spot_ids);
      for (const id of current) if (!next.has(id)) del.run(e.product_id, id);
      const have = new Set(current);
      for (const id of e.spot_ids) {
        if (!have.has(id)) {
          const m = (maxSort.get(id) as { m: number }).m;
          ins.run(e.product_id, id, m + 10);
        }
      }
    }
  });
  tx();
}

/** All placements for a set of products (used to build a session's guided route). */
export function getPlacementsForProducts(productIds: number[]): ProductPlacement[] {
  if (productIds.length === 0) return [];
  const db = getDb();
  const ph = productIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT odoo_product_id, count_location_id, shelf_sort FROM product_locations WHERE odoo_product_id IN (${ph})`
  ).all(...productIds) as ProductPlacement[];
}

// ===
// SESSION LOCATION STATUS (guided route — per-stop counted/skipped state)
// ===

export function setSessionLocationStatus(
  sessionId: number, countLocationId: number, status: string, skipReason: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO session_location_status (session_id, count_location_id, status, skip_reason, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, count_location_id) DO UPDATE SET
      status = excluded.status, skip_reason = excluded.skip_reason, updated_at = excluded.updated_at
  `).run(sessionId, countLocationId, status, skipReason ?? null, now());
}

/**
 * What this product came out at the LAST few times it was counted and approved.
 * Context for a reviewer staring at a number with nothing to compare it to —
 * "28-36 Units the last five times" makes 300 obvious and 31 boring.
 *
 * Approved counts only: a submitted-but-unreviewed number is not yet a fact,
 * and the session being reviewed right now must never compare against itself.
 * Totals are summed across spots, matching how approval reads a count.
 *
 * An out-of-stock line counts as the zero it is. Dropping those would hide the
 * weeks we ran out AND make "last 5 counts" a lie when only 3 came back.
 */
export function getProductCountHistory(
  companyId: number,
  productIds: number[],
  opts: { excludeSessionId?: number; perProduct?: number } = {},
): Record<number, { qty: number | null; date: string; not_found?: boolean }[]> {
  const out: Record<number, { qty: number | null; date: string; not_found?: boolean }[]> = {};
  if (productIds.length === 0) return out;
  const db = getDb();
  const perProduct = opts.perProduct ?? 5;
  const placeholders = productIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT e.product_id AS product_id,
           s.id AS session_id,
           COALESCE(s.scheduled_date, s.created_at) AS date,
           SUM(COALESCE(e.counted_qty, 0)) AS qty,
           MAX(COALESCE(e.not_found, 0)) AS had_not_found
    FROM count_entries e
    JOIN counting_sessions s ON s.id = e.session_id
    WHERE s.company_id = ?
      AND s.status = 'approved'
      AND e.product_id IN (${placeholders})
      AND s.id != ?
    GROUP BY e.product_id, s.id
    ORDER BY e.product_id, date DESC
  `).all(companyId, ...productIds, opts.excludeSessionId ?? -1) as
    { product_id: number; date: string; qty: number; had_not_found: number }[];
  rows.forEach((r) => {
    const list = (out[r.product_id] ||= []);
    // A count that could not FIND the product has no total for it — showing the
    // sum of the spots where it was found would put a number in the history
    // that nobody ever counted. Kept as a dated entry with no quantity, so the
    // gap is visible rather than the count silently vanishing from history.
    if (list.length < perProduct) {
      list.push(r.had_not_found
        ? { qty: null, date: String(r.date), not_found: true }
        : { qty: Number(r.qty), date: String(r.date) });
    }
  });
  return out;
}

/**
 * How much recorded counting work a delete would destroy. Non-zero means refuse.
 *
 * An ENTRY is a number a person typed on a shelf — including "nothing here",
 * which is also an answer. It is work whatever state its count is in, so any
 * entry blocks the delete. It used to block only for submitted and approved
 * counts, while the cleanup deleted entries from pending, in_progress and
 * rejected ones: a manager could delete a product while someone was mid-count
 * and wipe what they had already entered, with nothing said to either of them.
 *
 * A frozen SNAPSHOT LINE is different. In an untouched count it is just "this
 * product was on the list", carries no one's work, and is safely dropped — so
 * it only blocks for counts that are submitted or approved, where the line is
 * what justifies the numbers.
 *
 * Archiving remains the way through: it hides the product without touching a
 * single recorded number.
 */
export function countLockedLinesForProduct(productId: number): number {
  // One implementation, counted once — see describeCountWorkForProduct below.
  return describeCountWorkForProduct(productId).total;
}

/**
 * The same question, answered in words a manager can act on: what exactly would
 * be destroyed. "It is in a count" is not actionable; "Marco has counted this on
 * Daily Count, still open" is.
 */
export function describeCountWorkForProduct(
  productId: number,
  /** Restaurants the caller may see. Lists outside them are counted but not named. */
  visibleCompanyIds?: number[] | null,
): {
  total: number; entries: number; quick: number; lockedLines: number; where: string[];
} {
  const db = getDb();
  const LOCKED = "('approved','submitted')";
  const rows = db.prepare(`
    SELECT s.status AS status, COUNT(*) AS n,
           COALESCE(t.name, 'a count') AS list_name,
           s.company_id AS company_id
      FROM count_entries e
      JOIN counting_sessions s ON s.id = e.session_id
      LEFT JOIN counting_templates t ON t.id = s.template_id
     WHERE e.product_id = ?
     GROUP BY s.status, t.name, s.company_id
     ORDER BY n DESC
  `).all(productId) as { status: string; n: number; list_name: string; company_id: number | null }[];
  // A quick count is an entered quantity — except a REJECTED one, which a
  // manager has already thrown away. Blocking on those would be a dead end:
  // nothing in the portal can clear a rejected quick count, and the cleanup
  // deletes them anyway, so the product could never be deleted by any route.
  const quick = (db.prepare(
    "SELECT COUNT(*) AS n FROM quick_counts WHERE product_id = ? AND COALESCE(status,'pending') != 'rejected'",
  ).get(productId) as { n: number } | undefined)?.n || 0;
  const lockedLines = (db.prepare(`
    SELECT COUNT(*) AS n FROM session_count_items i
      JOIN counting_sessions s ON s.id = i.session_id
     WHERE i.odoo_product_id = ? AND s.status IN ${LOCKED}
  `).get(productId) as { n: number } | undefined)?.n || 0;

  const plain: Record<string, string> = {
    pending: 'not started yet', in_progress: 'still being counted',
    submitted: 'waiting to be approved', approved: 'already approved',
    rejected: 'sent back to be redone',
  };
  // A manager must be told SOMETHING is in the way, but never the name of
  // another restaurant's counting list.
  const canSee = (cid: number | null) =>
    !visibleCompanyIds || cid == null || visibleCompanyIds.includes(cid);
  const where = rows.map((r) => {
    const what = canSee(r.company_id) ? `on "${r.list_name}"` : 'at another restaurant';
    return `${r.n} ${r.n === 1 ? 'entry' : 'entries'} ${what} (${plain[r.status] || r.status})`;
  });
  if (quick > 0) where.push(`${quick} quick ${quick === 1 ? 'count' : 'counts'}`);
  const entries = rows.reduce((n, r) => n + r.n, 0);
  return { total: entries + quick + lockedLines, entries, quick, lockedLines, where };
}

/**
 * Remove the portal's SETTINGS for a product that has just been deleted
 * outright — its flags, photos, placements, packaging chain, draft record and
 * membership of counting lists — plus any line in a count still open.
 *
 * Deliberately narrow. A product id also appears in purchase order lines,
 * receipts, POS links and prep history, and those are business records, not
 * settings; if any existed in Odoo it would have refused the delete, and where
 * only the portal has them, leaving a row that names a gone product is far
 * better than destroying the record. Approved counts are ruled out before this
 * is ever called (see countApprovedLinesForProduct).
 */
export function deleteProductPortalData(productId: number): { countWorkPreserved: number } {
  const db = getDb();
  let preserved = 0;
  const tx = db.transaction(() => {
    // The route checked for counting work BEFORE talking to Odoo, and that call
    // can take up to 30 seconds. Somebody can finish a shelf in that window. So
    // ask again HERE, inside the transaction, where nothing can interleave:
    // if work has appeared, keep every entry and delete only the rest.
    // The Odoo product is already gone by now, so there is nothing to roll back
    // to — the choice is keep the numbers or lose them, and we keep them.
    preserved = describeCountWorkForProduct(productId).total;
    if (preserved === 0) {
      // Photos hang off row ids, so they go before the rows do — and only for
      // lines in counts that are still open.
      const openEntries = db.prepare(`
        SELECT e.id FROM count_entries e
          JOIN counting_sessions s ON s.id = e.session_id
         WHERE e.product_id = ? AND s.status IN ('pending','in_progress','rejected')
      `).all(productId) as { id: number }[];
      openEntries.forEach((r) => deleteCountPhotos('count_entries', r.id));
      if (openEntries.length > 0) {
        db.prepare(`DELETE FROM count_entries WHERE id IN (${openEntries.map(() => '?').join(',')})`)
          .run(...openEntries.map((r) => r.id));
      }
      const openQuick = db.prepare(
        "SELECT id FROM quick_counts WHERE product_id = ? AND COALESCE(status,'pending') IN ('pending','rejected')",
      ).all(productId) as { id: number }[];
      openQuick.forEach((r) => deleteCountPhotos('quick_counts', r.id));
      if (openQuick.length > 0) {
        db.prepare(`DELETE FROM quick_counts WHERE id IN (${openQuick.map(() => '?').join(',')})`)
          .run(...openQuick.map((r) => r.id));
      }
    }

    // Settings and placements: these describe the product, so they go with it.
    //
    // This list MUST match the tables describeProductUsage treats as removable.
    // Anything classified removable but not cleaned here is the worst of both:
    // the delete is allowed, and the row is left pointing at an id nothing can
    // resolve. The last five were exactly that.
    for (const [table, col] of [
      ['product_flags', 'odoo_product_id'],
      ['product_images', 'odoo_product_id'],
      ['product_locations', 'odoo_product_id'],
      ['product_packaging_levels', 'odoo_product_id'],
      ['product_drafts', 'odoo_product_id'],
      ['template_product_locations', 'odoo_product_id'],
      ['product_par', 'odoo_product_id'],                 // per-restaurant par levels
      ['portal_created_products', 'odoo_product_id'],      // the "we made this" marker
      ['prep_pos_link', 'pos_product_id'],                 // prep-planner mapping
      ['prep_forecasts', 'product_id'],                    // derived, regenerated by the next run
    ] as const) {
      try { db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(productId); }
      catch { /* a table this build does not have */ }
    }

    // KDS is UNLINKED rather than deleted. Its config is keyed by product NAME as
    // well as id and the id column is nullable, so a station's setup — which
    // screen a dish appears on, how it is prepped — survives the product going
    // away instead of being thrown out with it.
    try { db.prepare('UPDATE kds_product_config SET odoo_product_id = NULL WHERE odoo_product_id = ?').run(productId); }
    catch { /* a table this build does not have */ }

    // The frozen line of a count is part of THAT COUNT, not of the product, and
    // it only leaves with counts that are still open. Deleting it from a
    // submitted count stranded the count forever — its entry survived while the
    // snapshot line that justifies the entry did not, so approval refused the
    // line as off-list and there is no path back. Deleting it from an APPROVED
    // count quietly rewrote what a signed-off count had covered.
    const OPEN = "('pending','in_progress','rejected')";
    for (const table of ['session_count_items', 'session_packaging_levels'] as const) {
      try {
        db.prepare(`
          DELETE FROM ${table}
           WHERE odoo_product_id = ?
             AND session_id IN (SELECT id FROM counting_sessions WHERE status IN ${OPEN})
        `).run(productId);
      } catch { /* a table this build does not have */ }
    }

    // Counting lists keep their products as a JSON array, so the id has to be
    // taken out by hand or every list keeps asking for something that is gone.
    try {
      const rows = db.prepare('SELECT id, product_ids FROM counting_templates').all() as { id: number; product_ids: string }[];
      const upd = db.prepare('UPDATE counting_templates SET product_ids = ? WHERE id = ?');
      for (const r of rows) {
        let ids: number[] = [];
        try { ids = JSON.parse(r.product_ids || '[]'); } catch { continue; }
        if (!Array.isArray(ids) || !ids.includes(productId)) continue;
        upd.run(JSON.stringify(ids.filter((x) => x !== productId)), r.id);
      }
    } catch { /* leave the lists alone rather than corrupt them */ }
  });
  tx();
  return { countWorkPreserved: preserved };
}

export function getSessionLocationStatuses(sessionId: number): { count_location_id: number; status: string; skip_reason: string | null }[] {
  const db = getDb();
  return db.prepare(
    'SELECT count_location_id, status, skip_reason FROM session_location_status WHERE session_id = ?'
  ).all(sessionId) as { count_location_id: number; status: string; skip_reason: string | null }[];
}

// ===
// LOCATION KINDS (per-company manageable "type" list for count locations)
// ===

export interface LocationKindRow {
  id: number;
  company_id: number;
  kind: string;   // stored value on count_locations.kind (lowercase)
  label: string;  // what managers see in the Type dropdown
  icon: string;   // emoji shown in the tree / spot picker / printed labels
  sort_order: number;
  /** 1 = marks a thing (valve, fuse box): holds nothing, nests nothing. */
  marker_only?: number | null;
}

/**
 * List a company's CUSTOM location types. The built-in types (see
 * src/lib/location-types.ts) are the always-available base and live in code, NOT
 * here — this table holds only the types a manager has added, so custom types can
 * never duplicate the built-ins. Starts empty; no seeding.
 */
export function listLocationKinds(companyId: number): LocationKindRow[] {
  const db = getDb();
  // marker_only rides along so a caller can tell a PLACE (shelf, fridge) from a
  // MARKER (shut-off valve, fuse box) without a second query. The column is
  // added by the floorplan init; COALESCE keeps this working on a database
  // that has not run it yet.
  const hasMarker = (db.prepare('PRAGMA table_info(location_kinds)').all() as { name: string }[])
    .some(c => c.name === 'marker_only');
  return db.prepare(
    `SELECT id, company_id, kind, label, icon, sort_order${hasMarker ? ', marker_only' : ''} FROM location_kinds WHERE company_id = ? ORDER BY sort_order, id`
  ).all(companyId) as LocationKindRow[];
}

/**
 * Add a CUSTOM type with its emoji. The stored `kind` value is the lowercased
 * label (kept simple — count_locations.kind is free text). Returns null when a
 * same-named type already exists for the company (case-insensitive). The icon
 * defaults to '📍' when none is supplied.
 */
export function addLocationKind(companyId: number, label: string, icon: string, userId: number): LocationKindRow | null {
  const db = getDb();
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const emoji = (icon || '').trim() || '📍';
  const kind = clean.toLowerCase();
  // Duplicate if either the stored kind or the visible label matches. Compare in
  // JS (SQLite lower() only folds ASCII; German names like "Kühlraum" are real).
  const existing = db.prepare('SELECT kind, label FROM location_kinds WHERE company_id = ?').all(companyId) as { kind: string; label: string }[];
  if (existing.some((r) => (r.kind || '').toLowerCase() === kind || (r.label || '').toLowerCase() === kind)) return null;
  const maxSort = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM location_kinds WHERE company_id = ?'
  ).get(companyId) as { m: number }).m;
  try {
    const r = db.prepare(
      'INSERT INTO location_kinds (company_id, kind, label, icon, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(companyId, kind, clean, emoji, maxSort + 10, userId, now());
    return {
      id: r.lastInsertRowid as number, company_id: companyId, kind, label: clean, icon: emoji, sort_order: maxSort + 10,
    };
  } catch {
    // Unique-constraint race (two adds of the same name) → treat as duplicate
    return null;
  }
}

/**
 * Delete a kind — refused while any of the company's active locations still
 * uses it (returns the usage count so the UI can explain).
 */
export function deleteLocationKind(id: number, companyId: number): { ok: boolean; in_use: number } {
  const db = getDb();
  const row = db.prepare(
    'SELECT kind FROM location_kinds WHERE id = ? AND company_id = ?'
  ).get(id, companyId) as { kind: string } | undefined;
  if (!row) return { ok: false, in_use: 0 };
  // Compare in JS: SQLite lower() only folds ASCII, and German type names
  // (Kühlraum…) are realistic here. JS toLowerCase() is Unicode-correct.
  const target = row.kind.toLowerCase();
  // In use means in use at ANY depth. This once looked at roots only, on the
  // reasoning that types describe areas — but the floorplan's own types (a
  // fuse box, a shelf, a marker) live NESTED under a room, so deleting one
  // took its settings with it and left every location of that type behaving
  // like an ordinary kind nobody had defined.
  const used = (db.prepare(
    'SELECT kind FROM count_locations WHERE company_id = ? AND active = 1'
  ).all(companyId) as { kind: string }[])
    .filter((l) => (l.kind || '').toLowerCase() === target).length;
  if (used > 0) return { ok: false, in_use: used };
  db.prepare('DELETE FROM location_kinds WHERE id = ? AND company_id = ?').run(id, companyId);
  return { ok: true, in_use: 0 };
}

/**
 * Rename a type's visible LABEL and update its emoji — the `kind` slug is left
 * untouched so every location already tagged with it stays linked (locations
 * reference the slug, and the label/icon are resolved from here for display).
 * Refused if another type in the company already uses that name. A blank icon
 * falls back to '📍'.
 */
export function renameLocationKind(id: number, companyId: number, label: string, icon: string): { ok: boolean; dupe?: boolean } {
  const db = getDb();
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false };
  const emoji = (icon || '').trim() || '📍';
  const rows = db.prepare('SELECT id, kind, label FROM location_kinds WHERE company_id = ?').all(companyId) as { id: number; kind: string; label: string }[];
  if (!rows.some((r) => r.id === id)) return { ok: false };
  // Compare in JS: SQLite lower() only folds ASCII, but German type names
  // (Kühlraum…) are realistic. JS toLowerCase() is Unicode-correct.
  const lower = clean.toLowerCase();
  const dupe = rows.some((r) => r.id !== id && ((r.kind || '').toLowerCase() === lower || (r.label || '').toLowerCase() === lower));
  if (dupe) return { ok: false, dupe: true };
  db.prepare('UPDATE location_kinds SET label = ?, icon = ? WHERE id = ? AND company_id = ?').run(clean, emoji, id, companyId);
  return { ok: true };
}

// ── "Count by" unit vocabulary (pack_labels) — GLOBAL, manager-editable ──
const DEFAULT_PACK_LABELS = ['piece', 'bunch', 'head', 'crate', 'case', 'box', 'tray', 'bag', 'pack'];

export interface PackLabelRow { id: number; label: string; sort_order: number; in_use?: number }

/** List the count-by units, seeding the defaults on first use. */
// ── Multi-level packaging (box -> pack -> piece) ─────────────────────────────
// The arithmetic lives in src/lib/packaging.ts (pure, unit-tested); this is only
// storage. Rows are GLOBAL per Odoo product: a different supplier is a different
// product, so one product has exactly one chain.

export interface PackagingLevelRow {
  id: number;
  odoo_product_id: number;
  name: string;
  to_base: number;
  countable: number;
  allow_partial: number;
  barcode: string | null;
  sort_order: number;
}

/**
 * Storage row -> the shape the pure engine speaks. Lives here (not in the API
 * route) because a Next.js route file may only export its HTTP handlers — an
 * extra export fails the build, and tsc --noEmit does not catch it.
 */
export function toPackLevel(r: PackagingLevelRow): PackLevel {
  return {
    id: r.id,
    name: r.name,
    toBase: r.to_base,
    countable: r.countable === 1,
    allowPartial: r.allow_partial === 1,
  };
}

/** A product's live levels, biggest first (the order the count screen shows). */
export function listPackagingLevels(productId: number): PackagingLevelRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, odoo_product_id, name, to_base, countable, allow_partial, barcode, sort_order
    FROM product_packaging_levels
    WHERE odoo_product_id = ? AND active = 1
    ORDER BY to_base DESC, id
  `).all(productId) as PackagingLevelRow[];
}

/** Live levels for several products at once (one query for a whole list screen). */
export function listPackagingLevelsFor(productIds: number[]): Map<number, PackagingLevelRow[]> {
  const out = new Map<number, PackagingLevelRow[]>();
  if (!productIds || productIds.length === 0) return out;
  const db = getDb();
  const ph = productIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, odoo_product_id, name, to_base, countable, allow_partial, barcode, sort_order
    FROM product_packaging_levels
    WHERE odoo_product_id IN (${ph}) AND active = 1
    ORDER BY to_base DESC, id
  `).all(...productIds) as PackagingLevelRow[];
  rows.forEach((r) => {
    const arr = out.get(r.odoo_product_id) || [];
    arr.push(r);
    out.set(r.odoo_product_id, arr);
  });
  return out;
}

/**
 * Replace a product's whole chain in ONE transaction — all levels or none, so a
 * half-written chain can never convert a count.
 *
 * Levels are ARCHIVED (active = 0), never deleted: a count entry may have been
 * stored against a level id, and a hard delete would leave that quantity
 * pointing at nothing. An id that is submitted again is UPDATED in place, so it
 * keeps its identity (and anything already stored against it stays correct).
 *
 * Rejects a chain that would mis-convert — a non-positive `to_base`, or two live
 * levels sharing a size/name — because a bad conversion misprices stock silently
 * and forever.
 */
export function setPackagingLevels(
  productId: number,
  levels: { id?: number | null; name: string; to_base: number; countable?: boolean; allow_partial?: boolean; barcode?: string | null }[],
  userId: number,
): PackagingLevelRow[] {
  const db = getDb();
  if (!Array.isArray(levels)) throw new Error('PACKAGING_INVALID: levels must be a list');

  // Validate STRICTLY and by hand: a malformed payload must come back as a clear
  // 400, never a TypeError surfacing as a 500, and a string id like "12" must
  // not be treated as a new level (which would archive the real one).
  const clean = levels.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`PACKAGING_INVALID: level ${i + 1} is not filled in`);
    const l = raw as Record<string, unknown>;
    if (l.id !== undefined && l.id !== null && !(typeof l.id === 'number' && Number.isSafeInteger(l.id) && l.id > 0)) {
      throw new Error(`PACKAGING_INVALID: level ${i + 1} has a bad id`);
    }
    if (typeof l.name !== 'string' || !l.name.trim()) throw new Error(`PACKAGING_INVALID: level ${i + 1} needs a name`);
    if (typeof l.to_base !== 'number' || !Number.isFinite(l.to_base)) {
      throw new Error(`PACKAGING_INVALID: “${l.name}” needs a size`);
    }
    if (l.to_base === 1) {
      // The engine treats 1 as the base unit itself and drops it, so persisting
      // it would return 200 for a level that then silently never counts.
      throw new Error(`PACKAGING_INVALID: “${l.name}” is worth one base unit — that is the base unit itself, not packaging`);
    }
    if (l.to_base < MIN_TO_BASE || l.to_base > MAX_TO_BASE) {
      // Below the storage quantum one whole package converts to zero; above it
      // the arithmetic overflows to Infinity, which also rounds to zero.
      throw new Error(`PACKAGING_INVALID: “${l.name}” must be between ${MIN_TO_BASE} and ${MAX_TO_BASE}`);
    }
    if (l.countable !== undefined && typeof l.countable !== 'boolean') throw new Error(`PACKAGING_INVALID: “${l.name}” has a bad countable flag`);
    if (l.allow_partial !== undefined && typeof l.allow_partial !== 'boolean') throw new Error(`PACKAGING_INVALID: “${l.name}” has a bad partial flag`);
    if (l.barcode !== undefined && l.barcode !== null && typeof l.barcode !== 'string') throw new Error(`PACKAGING_INVALID: “${l.name}” has a bad barcode`);
    return {
      id: (l.id as number | null | undefined) ?? null,
      name: (l.name as string).trim().replace(/\s+/g, ' '),
      to_base: l.to_base as number,
      countable: l.countable === false ? 0 : 1,
      allow_partial: l.allow_partial === true ? 1 : 0,
      barcode: ((l.barcode as string | null | undefined) || '').trim() || null,
    };
  });

  const bySize = new Map<number, string>();
  const byName = new Set<string>();
  const byId = new Set<number>();
  for (const l of clean) {
    // The same id twice updated one row twice and quietly dropped a level.
    if (l.id != null) {
      if (byId.has(l.id)) throw new Error(`PACKAGING_INVALID: “${l.name}” is listed twice`);
      byId.add(l.id);
    }
    const sizeClash = bySize.get(l.to_base);
    if (sizeClash) throw new Error(`PACKAGING_INVALID: “${l.name}” and “${sizeClash}” are both ${l.to_base}`);
    bySize.set(l.to_base, l.name);
    const key = l.name.toLowerCase();
    if (byName.has(key)) throw new Error(`PACKAGING_INVALID: two levels called “${l.name}”`);
    byName.add(key);
  }

  let saved: PackagingLevelRow[] = [];
  const tx = db.transaction(() => {
    // Park EVERY current row first, then bring back the submitted ones. Updating
    // in place made a legitimate rename swap (box->pack, pack->box) collide with
    // the partial unique index on the row that had not been renamed yet.
    db.prepare('UPDATE product_packaging_levels SET active = 0 WHERE odoo_product_id = ? AND active = 1')
      .run(productId);

    const upd = db.prepare(`
      UPDATE product_packaging_levels
      SET name = ?, to_base = ?, countable = ?, allow_partial = ?, barcode = ?, sort_order = ?, active = 1,
          updated_by = ?, updated_at = ?
      WHERE id = ? AND odoo_product_id = ?
    `);
    const ins = db.prepare(`
      INSERT INTO product_packaging_levels
        (odoo_product_id, name, to_base, countable, allow_partial, barcode, sort_order, active, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);
    clean.forEach((l, i) => {
      const order = (i + 1) * 10;
      if (l.id != null) {
        const r = upd.run(l.name, l.to_base, l.countable, l.allow_partial, l.barcode, order, userId, now(), l.id, productId);
        // An id from ANOTHER product changes no rows — never adopted silently.
        if (r.changes === 0) throw new Error('PACKAGING_INVALID: that level does not belong to this product');
      } else {
        ins.run(productId, l.name, l.to_base, l.countable, l.allow_partial, l.barcode, order, userId, now(), userId, now());
      }
    });

    // Read back INSIDE the transaction: a list taken after commit can already
    // show another writer's chain, which the caller would then believe is theirs.
    saved = db.prepare(`
      SELECT id, odoo_product_id, name, to_base, countable, allow_partial, barcode, sort_order
      FROM product_packaging_levels
      WHERE odoo_product_id = ? AND active = 1
      ORDER BY to_base DESC, id
    `).all(productId) as PackagingLevelRow[];
  });
  tx.immediate();
  return saved;
}

export function listPackLabels(): PackLabelRow[] {
  const db = getDb();
  // Seed inside ONE transaction so a concurrent worker can't observe a partial
  // vocabulary mid-seed; INSERT OR IGNORE keeps a double-seed idempotent.
  db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM pack_labels').get() as { n: number }).n;
    if (n === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO pack_labels (label, sort_order, created_at) VALUES (?, ?, ?)');
      DEFAULT_PACK_LABELS.forEach((l, i) => ins.run(l, (i + 1) * 10, now()));
    }
  })();
  const rows = db.prepare('SELECT id, label, sort_order FROM pack_labels ORDER BY sort_order, id').all() as PackLabelRow[];
  // Attach how many products are counted in each unit (case-insensitive JS,
  // matching the delete guard) so the UI can show it + block delete-while-in-use.
  const flags = db.prepare('SELECT pack_label FROM product_flags WHERE pack_label IS NOT NULL').all() as { pack_label: string }[];
  const counts = new Map<string, number>();
  for (const f of flags) { const k = (f.pack_label || '').toLowerCase(); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  return rows.map((r) => ({ ...r, in_use: counts.get(r.label.toLowerCase()) || 0 }));
}

/** Odoo product ids counted in a given unit (case-insensitive), so the manager
 *  can see exactly which products a merge/delete would touch. */
export function productIdsUsingPackLabel(label: string): number[] {
  const db = getDb();
  const target = label.trim().toLowerCase();
  if (!target) return [];
  const rows = db.prepare('SELECT odoo_product_id, pack_label FROM product_flags WHERE pack_label IS NOT NULL').all() as { odoo_product_id: number; pack_label: string }[];
  return rows.filter((r) => (r.pack_label || '').toLowerCase() === target).map((r) => r.odoo_product_id);
}

/** Add a unit; returns null on a duplicate (Unicode case-insensitive) or bad label. */
export function addPackLabel(label: string, userId: number): PackLabelRow | null {
  const db = getDb();
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 24) return null;
  // Dedup check + insert in ONE transaction, compared in JS (SQLite lower() only
  // folds ASCII — "Kühl"/"KÜHL" would otherwise both slip in).
  return db.transaction(() => {
    const existing = db.prepare('SELECT label FROM pack_labels').all() as { label: string }[];
    if (existing.some((e) => e.label.toLowerCase() === clean.toLowerCase())) return null;
    const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM pack_labels').get() as { m: number }).m;
    const r = db.prepare('INSERT INTO pack_labels (label, sort_order, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(clean, maxSort + 10, userId, now());
    return { id: r.lastInsertRowid as number, label: clean, sort_order: maxSort + 10 };
  })();
}

/** Delete a unit — refused while any product is still counted in it. */
export function deletePackLabel(id: number): { ok: boolean; in_use: number } {
  const db = getDb();
  const row = db.prepare('SELECT label FROM pack_labels WHERE id = ?').get(id) as { label: string } | undefined;
  if (!row) return { ok: false, in_use: 0 };
  const target = row.label.toLowerCase();
  const used = (db.prepare('SELECT pack_label FROM product_flags WHERE pack_label IS NOT NULL').all() as { pack_label: string }[])
    .filter((f) => (f.pack_label || '').toLowerCase() === target).length;
  if (used > 0) return { ok: false, in_use: used };
  db.prepare('DELETE FROM pack_labels WHERE id = ?').run(id);
  return { ok: true, in_use: 0 };
}

/**
 * Rename a count-by unit. Because product_flags stores the label STRING (not an
 * id), the rename CASCADES to every product counted in the old label so none is
 * orphaned. Dup-guarded (Unicode-safe). Whole thing is one transaction.
 */
export function renamePackLabel(id: number, label: string): { ok: boolean; dupe?: boolean } {
  const db = getDb();
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 24) return { ok: false };
  return db.transaction(() => {
    const rows = db.prepare('SELECT id, label FROM pack_labels').all() as { id: number; label: string }[];
    const self = rows.find((r) => r.id === id);
    if (!self) return { ok: false };
    const lower = clean.toLowerCase();
    if (rows.some((r) => r.id !== id && r.label.toLowerCase() === lower)) return { ok: false, dupe: true };
    if (self.label === clean) return { ok: true };   // no-op (identical)
    // Cascade the rename to every product counted in the old unit.
    const oldLower = self.label.toLowerCase();
    const distinct = db.prepare('SELECT DISTINCT pack_label FROM product_flags WHERE pack_label IS NOT NULL').all() as { pack_label: string }[];
    const upd = db.prepare('UPDATE product_flags SET pack_label = ? WHERE pack_label = ?');
    distinct.filter((f) => (f.pack_label || '').toLowerCase() === oldLower).forEach((f) => upd.run(clean, f.pack_label));
    db.prepare('UPDATE pack_labels SET label = ? WHERE id = ?').run(clean, id);
    return { ok: true };
  })();
}

/**
 * Merge one count-by unit INTO another: reassign every product counted in `from`
 * to `into`, then delete `from`. Lets a manager collapse a duplicate/wrong unit
 * (e.g. "head" → "piece") in one step instead of editing each product. Pure
 * relabel — a product's pack SIZE lives on the product, not the unit, so counts
 * keep their meaning. All-or-nothing.
 */
export function mergePackLabels(fromId: number, intoId: number): { ok: boolean; moved?: number; error?: 'same' | 'notfound' } {
  if (fromId === intoId) return { ok: false, error: 'same' };
  const db = getDb();
  return db.transaction(() => {
    const from = db.prepare('SELECT id, label FROM pack_labels WHERE id = ?').get(fromId) as { id: number; label: string } | undefined;
    const into = db.prepare('SELECT id, label FROM pack_labels WHERE id = ?').get(intoId) as { id: number; label: string } | undefined;
    if (!from || !into) return { ok: false, error: 'notfound' as const };
    const fromLower = from.label.toLowerCase();
    const distinct = db.prepare('SELECT DISTINCT pack_label FROM product_flags WHERE pack_label IS NOT NULL').all() as { pack_label: string }[];
    const upd = db.prepare('UPDATE product_flags SET pack_label = ? WHERE pack_label = ?');
    let moved = 0;
    distinct.filter((f) => (f.pack_label || '').toLowerCase() === fromLower).forEach((f) => { moved += upd.run(into.label, f.pack_label).changes; });
    db.prepare('DELETE FROM pack_labels WHERE id = ?').run(fromId);
    return { ok: true, moved };
  })();
}

/**
 * Remember that the portal created this product, so the catalog's relevance
 * filter cannot hide it before it has been used for anything.
 *
 * Idempotent — re-recording is a no-op, so a retried create cannot fail here.
 */
export function recordPortalCreatedProduct(odooProductId: number, userId: number | null): void {
  getDb().prepare(
    `INSERT INTO portal_created_products (odoo_product_id, created_at, created_by)
     VALUES (?, ?, ?) ON CONFLICT(odoo_product_id) DO NOTHING`,
  ).run(odooProductId, new Date().toISOString(), userId);
}

export interface PendingDraft {
  odoo_product_id: number;
  barcode: string;
  created_by: number;
  created_at: string;
}

/**
 * Drafts still awaiting a decision, oldest first — the oldest is the one that
 * has been holding up a count the longest.
 */
export function listPendingDrafts(): PendingDraft[] {
  return getDb().prepare(
    `SELECT odoo_product_id, barcode, created_by, created_at
       FROM product_drafts WHERE status = 'pending' ORDER BY created_at ASC`,
  ).all() as PendingDraft[];
}

/** Every product the portal created — unioned into the relevance set. */
export function listPortalCreatedProductIds(): number[] {
  const rows = getDb().prepare('SELECT odoo_product_id FROM portal_created_products')
    .all() as { odoo_product_id: number }[];
  return rows.map((r) => r.odoo_product_id);
}

/* ------------------------------------------------------------------------- *
 * DELETING A PRODUCT — what would go with it.
 *
 * Odoo refuses to delete a product it has history for, but it knows nothing
 * about this portal's database, and 24 tables across six modules hold an Odoo
 * product id. The old guard checked two of them (counts and counting lists), so
 * deleting a product could silently orphan an order line, a receipt, a printed
 * container label or a cook profile — rows that then reference an id nothing can
 * resolve, in screens that show history.
 *
 * The split is between WORK SOMEBODY DID and SETTINGS SOMEBODY CHOSE:
 *
 *   blocking  — a record of something that happened, or is happening. A count, an
 *               order, a receipt, a label, an open cart. Deleting the product
 *               would leave a hole in a record of the past, so it is refused and
 *               the reason is named.
 *
 *   removable — settings that only exist to describe this product: its picture,
 *               its pack size, its par level, where it lives. Meaningless without
 *               it, so they go with it.
 * ------------------------------------------------------------------------- */

export interface ProductUsage {
  /** Human phrases naming what stands in the way. Empty = deletable. */
  blocking: string[];
  /** Whether anything at all references the product. */
  used: boolean;
}

/**
 * One row per table to check, in the order a person would care about them.
 *
 * `table` and `column` are separate from the phrasing so the existence check
 * below can be done per table. Most of these belong to OTHER modules (purchase,
 * labels, prep planner, cook timer), each of which creates its tables in its own
 * init — so at any moment some of them may genuinely not exist yet in this
 * database. That is not the same as being unreadable, and the two must be
 * answered differently: an absent table holds no rows, while a table that exists
 * and will not answer is a real unknown.
 */
const BLOCKING_CHECKS: {
  table: string; column: string; one: string; many: (n: number) => string;
}[] = [
  // NOTE: counts are NOT here. count_entries, quick_counts, session_count_items
  // and counting_templates are all covered by describeCountWorkForProduct, which
  // knows the lifecycle rules this list cannot express — a REJECTED quick count is
  // discardable, and a frozen snapshot only blocks while its session is submitted
  // or approved. An earlier version of this list counted those tables raw, which
  // made products permanently undeletable that the real policy allows through.
  { table: 'purchase_order_lines', column: 'product_id',
    one: 'on a purchase order', many: (n) => `on ${n} purchase orders` },
  { table: 'purchase_receipt_lines', column: 'product_id',
    one: 'on a delivery that was received', many: (n) => `on ${n} deliveries that were received` },
  { table: 'purchase_cart_items', column: 'product_id',
    one: 'in an order being built right now', many: (n) => `in ${n} orders being built right now` },
  { table: 'purchase_guide_items', column: 'product_id',
    one: 'on an order guide', many: (n) => `on ${n} order guides` },
  { table: 'stock_receipts', column: 'odoo_product_id',
    one: 'booked in as received stock', many: (n) => `booked in as received stock ${n} times` },
  { table: 'container_splits', column: 'product_id',
    one: 'on a printed container label', many: (n) => `on ${n} printed container labels` },
  { table: 'prep_demand_history', column: 'product_id',
    one: 'in the sales history used for prep planning', many: () => 'in the sales history used for prep planning' },
  { table: 'cook_profiles', column: 'odoo_product_id',
    one: 'set up with cooking times', many: () => 'set up with cooking times' },
];

/** Does this table exist in the database yet? Its module may not have run. */
function tableExists(db: ReturnType<typeof getDb>, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name) as { ok: number } | undefined;
  return !!row;
}

/**
 * Everything OUTSIDE the counting system that would break if the product were
 * deleted. Counts and counting lists are checked by
 * describeCountWorkForProduct, which understands their lifecycle; this covers
 * the other five modules, which had no guard at all.
 */
export function describeProductUsage(productId: number): ProductUsage {
  const db = getDb();
  const blocking: string[] = [];

  for (const check of BLOCKING_CHECKS) {
    // A table whose module has never initialised in this process genuinely holds
    // no rows, so it cannot be blocking anything. Treating it as unknown — which
    // an earlier version did — refused EVERY delete until every module happened
    // to have run, which is a guard that never lets anyone through.
    if (!tableExists(db, check.table)) continue;
    let n = 0;
    try {
      n = (db.prepare(`SELECT COUNT(*) n FROM ${check.table} WHERE ${check.column} = ?`)
        .get(productId) as { n: number } | undefined)?.n ?? 0;
    } catch {
      // The table IS there and would not answer. That is a real unknown, and the
      // unknown answer must be "don't delete" — reading it as "nothing found" is
      // the answer that permits the delete.
      blocking.push('referenced by something that could not be checked just now');
      continue;
    }
    if (n > 0) blocking.push(n === 1 ? check.one : check.many(n));
  }

  // Counting lists are deliberately absent too — same reason as the count tables
  // above. describeCountWorkForProduct handles them, including the JSON array.
  return { blocking, used: blocking.length > 0 };
}

/* ------------------------------------------------------------------------- *
 * WASTE TRACKER
 *
 * The third input to the consumption equation. See the waste_events table above
 * for why it exists; these are the reads and writes the screen and the report
 * need, and nothing more.
 * ------------------------------------------------------------------------- */

export interface WasteEvent {
  id: number;
  company_id: number;
  department_id: number | null;
  odoo_product_id: number;
  count_location_id: number;
  qty_base: number;
  crate_qty: number | null;
  loose_qty: number | null;
  units_per_crate: number | null;
  uom: string;
  reason: string | null;
  note: string | null;
  photo: string | null;
  wasted_by: number;
  wasted_at: string;
  voided_at: string | null;
}

export interface NewWasteEvent {
  companyId: number;
  departmentId?: number | null;
  productId: number;
  locationId?: number;
  qtyBase: number;
  crateQty?: number | null;
  looseQty?: number | null;
  unitsPerCrate?: number | null;
  uom?: string;
  reason?: string | null;
  note?: string | null;
  photo?: string | null;
  userId: number;
  /** Idempotency handle: the same key always answers with the same row. */
  clientKey?: string | null;
}

/** Record something binned. Returns the row's id, so Undo has a handle. */
export function recordWaste(e: NewWasteEvent): number {
  // Finite AND capped, not just positive — Infinity or a fat-fingered 20 million
  // would pass a bare `> 0` and silently distort every usage figure after it.
  if (!Number.isFinite(e.qtyBase) || e.qtyBase <= 0 || e.qtyBase > 1e7) {
    throw new Error('WASTE_INVALID: the amount must be more than zero');
  }
  const key = e.clientKey || null;
  try {
    const info = getDb().prepare(`
      INSERT INTO waste_events
        (company_id, department_id, odoo_product_id, count_location_id, qty_base,
         crate_qty, loose_qty, units_per_crate, uom, reason, note, photo, wasted_by, wasted_at, client_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      e.companyId, e.departmentId ?? null, e.productId, e.locationId ?? 0, e.qtyBase,
      e.crateQty ?? null, e.looseQty ?? null, e.unitsPerCrate ?? null, e.uom || 'Units',
      e.reason || null, e.note || null, e.photo || null, e.userId, new Date().toISOString(), key,
    );
    return Number(info.lastInsertRowid);
  } catch (err) {
    // A replayed client key hits the unique index: that retry already succeeded,
    // so answer with the row it created rather than binning the crate twice.
    // Only for the SAME logical entry — a key resurfacing on another product,
    // person or restaurant is a bug or an attack, and acknowledging it would
    // silently swallow a real entry.
    if (key) {
      const existing = getDb().prepare(
        'SELECT id FROM waste_events WHERE client_key = ? AND company_id = ? AND odoo_product_id = ? AND wasted_by = ? AND qty_base = ?',
      ).get(key, e.companyId, e.productId, e.userId, e.qtyBase) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    throw err;
  }
}

/**
 * Undo. A soft delete on purpose: the entry stays, marked void, so a mis-tap
 * corrected thirty seconds later leaves a trail rather than a hole. The report
 * ignores voided rows, so the arithmetic is unaffected either way.
 */
export function voidWaste(id: number, userId: number): boolean {
  const r = getDb().prepare(
    'UPDATE waste_events SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL',
  ).run(new Date().toISOString(), userId, id);
  return r.changes > 0;
}

/**
 * Waste per product over a period — the term the consumption report subtracts.
 *
 * Deliberately the same signature as sumReceiptsByProduct, which supplies the
 * "purchases" term, so the report can call both the same way. The boundaries
 * match it too: exclusive at the start, inclusive at the end, so two adjacent
 * periods never both claim the same event.
 */
export function sumWasteByProduct(companyIds: number[] | null, from: string, to: string): Record<number, number> {
  const where: string[] = ['wasted_at > ?', 'wasted_at <= ?', 'voided_at IS NULL'];
  const vals: unknown[] = [from, to];
  if (companyIds) {
    if (companyIds.length === 0) return {};
    where.push(`company_id IN (${companyIds.map(() => '?').join(',')})`);
    vals.push(...companyIds);
  }
  const rows = getDb().prepare(
    `SELECT odoo_product_id AS pid, SUM(qty_base) AS total FROM waste_events
      WHERE ${where.join(' AND ')} GROUP BY odoo_product_id`,
  ).all(...vals) as { pid: number; total: number }[];
  const out: Record<number, number> = {};
  for (const r of rows) out[r.pid] = r.total;
  return out;
}

/**
 * What this department binned most recently — the "recently binned here" grid.
 *
 * Most-recent-first, one row per product, because the same dozen things get
 * thrown away over and over. It is what makes the common case a single tap
 * instead of a search.
 */
export function recentlyWastedProducts(companyId: number, limit = 8, departmentId?: number | null): number[] {
  // "Recently binned HERE": with a department the grid is that department's own
  // history — the bar's bottles must not fill the kitchen's screen. The caller
  // falls back to the whole restaurant when a department has none yet.
  const dept = departmentId ? ' AND department_id = ?' : '';
  const vals: unknown[] = departmentId ? [companyId, departmentId, limit] : [companyId, limit];
  const rows = getDb().prepare(`
    SELECT odoo_product_id AS pid, MAX(wasted_at) AS last_at
      FROM waste_events
     WHERE company_id = ? AND voided_at IS NULL${dept}
     GROUP BY odoo_product_id
     ORDER BY last_at DESC
     LIMIT ?
  `).all(...vals) as { pid: number }[];
  return rows.map((r) => r.pid);
}

/**
 * One entry by id, voided or not. The route needs to see WHOSE entry it is and
 * WHICH restaurant's before it lets anyone void or annotate it.
 */
export function getWasteEvent(id: number): WasteEvent | null {
  const row = getDb().prepare('SELECT * FROM waste_events WHERE id = ?').get(id) as WasteEvent | undefined;
  return row ?? null;
}

/**
 * Add the optional extras — reason / note / photo — to an entry that is ALREADY
 * saved. The mock's "or just walk away": the quantity commits at the numpad and
 * this only annotates, so nothing here may ever touch the amount. Only the
 * fields given are set; a voided entry is refused.
 */
export function annotateWaste(id: number, patch: { reason?: string | null; note?: string | null; photo?: string | null }): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.reason !== undefined) { sets.push('reason = ?'); vals.push(patch.reason || null); }
  if (patch.note !== undefined) { sets.push('note = ?'); vals.push(patch.note || null); }
  if (patch.photo !== undefined) { sets.push('photo = ?'); vals.push(patch.photo || null); }
  if (sets.length === 0) return false;
  vals.push(id);
  const r = getDb().prepare(
    `UPDATE waste_events SET ${sets.join(', ')} WHERE id = ? AND voided_at IS NULL`,
  ).run(...vals);
  return r.changes > 0;
}

/** Must an entry from this department carry a photo? Absent row = no — off by default. */
export function isWastePhotoRequired(departmentId: number): boolean {
  const row = getDb().prepare('SELECT photo_required FROM waste_settings WHERE department_id = ?')
    .get(departmentId) as { photo_required: number } | undefined;
  return !!row?.photo_required;
}

/** Flip the per-department photo switch. The route checks the caller may manage this company. */
export function setWastePhotoRequired(departmentId: number, companyId: number, on: boolean, userId: number): void {
  getDb().prepare(`
    INSERT INTO waste_settings (department_id, company_id, photo_required, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(department_id) DO UPDATE SET
      company_id = excluded.company_id, photo_required = excluded.photo_required,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(departmentId, companyId, on ? 1 : 0, userId, new Date().toISOString());
}

/** Every department switch for one restaurant — what the settings sheet renders. */
export function wastePhotoRequiredByDepartment(companyId: number): Record<number, boolean> {
  const rows = getDb().prepare('SELECT department_id, photo_required FROM waste_settings WHERE company_id = ?')
    .all(companyId) as { department_id: number; photo_required: number }[];
  const out: Record<number, boolean> = {};
  for (const r of rows) out[r.department_id] = !!r.photo_required;
  return out;
}

/** Recent entries, for the "what did we bin today" list and for Undo. */
export function listWaste(companyId: number, opts: { from?: string; to?: string; limit?: number } = {}): WasteEvent[] {
  const where: string[] = ['company_id = ?', 'voided_at IS NULL'];
  const vals: unknown[] = [companyId];
  if (opts.from) { where.push('wasted_at > ?'); vals.push(opts.from); }
  if (opts.to) { where.push('wasted_at <= ?'); vals.push(opts.to); }
  vals.push(opts.limit ?? 100);
  return getDb().prepare(
    `SELECT * FROM waste_events WHERE ${where.join(' AND ')} ORDER BY wasted_at DESC LIMIT ?`,
  ).all(...vals) as WasteEvent[];
}
