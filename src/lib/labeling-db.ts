/**
 * Labeling system SQLite tables: printers, container splits, print jobs,
 * saved label sizes, label size preferences.
 * Same DB file as portal.db via getDb().
 */
import { getDb } from './db';
import type {
  Printer, CreatePrinterRequest,
  ContainerSplit, Container, CreateSplitRequest,
  PrintJob, SavedCustomSize, LabelSizePreference,
} from '@/types/labeling';

function nowISO(): string {
  return new Date().toISOString();
}

// =============================================================================
// Schema
// =============================================================================

let _initialized = false;

export function ensureLabelingTables() {
  if (_initialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 9100,
      location_id INTEGER NOT NULL,
      location_name TEXT NOT NULL,
      dpi INTEGER NOT NULL DEFAULT 203,
      default_label_size_id TEXT NOT NULL DEFAULT '4x4',
      custom_width_mm REAL,
      custom_height_mm REAL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS container_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mo_id INTEGER NOT NULL,
      mo_name TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      total_qty REAL NOT NULL,
      uom TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_splits_mo ON container_splits(mo_id);
    CREATE TABLE IF NOT EXISTS containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      split_id INTEGER NOT NULL REFERENCES container_splits(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      qty REAL NOT NULL,
      lot_name TEXT,
      lot_id INTEGER,
      expiry_date TEXT,
      label_printed INTEGER NOT NULL DEFAULT 0,
      last_printed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_containers_split ON containers(split_id);
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers(id),
      printer_id INTEGER NOT NULL REFERENCES printers(id),
      printer_name TEXT NOT NULL,
      label_size_id TEXT NOT NULL,
      label_width_mm REAL NOT NULL,
      label_height_mm REAL NOT NULL,
      zpl_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      printed_by INTEGER NOT NULL,
      printed_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pj_container ON print_jobs(container_id);

    CREATE TABLE IF NOT EXISTS saved_label_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      width_mm REAL NOT NULL,
      height_mm REAL NOT NULL,
      company_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, company_id)
    );

    CREATE TABLE IF NOT EXISTS label_size_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      size_type TEXT NOT NULL DEFAULT 'preset',
      preset_id TEXT,
      saved_size_id INTEGER,
      custom_width_mm REAL,
      custom_height_mm REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, company_id)
    );

    CREATE TABLE IF NOT EXISTS custom_label_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      qty REAL,
      uom TEXT,
      label_count INTEGER,
      company_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_name, company_id)
    );
  `);

  // Seed a test printer if none exist
  const count = db.prepare('SELECT COUNT(*) as c FROM printers').get() as { c: number };
  if (count.c === 0) {
    const now = nowISO();
    db.prepare(`
      INSERT INTO printers (name, ip_address, port, location_id, location_name, dpi,
        default_label_size_id, custom_width_mm, custom_height_mm, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      'WAJ Kitchen Zebra', '192.168.1.100', 9100,
      22, 'What a Jerk / Stock', 203,
      '4x4', null, null,
      now, now
    );
    db.prepare(`
      INSERT INTO printers (name, ip_address, port, location_id, location_name, dpi,
        default_label_size_id, custom_width_mm, custom_height_mm, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      'Ssam Kitchen Zebra', '192.168.1.101', 9100,
      32, 'Ssam Korean BBQ / Stock', 203,
      '4x6', null, null,
      now, now
    );
    console.log('Labeling: seeded 2 test printers (update IPs in admin settings)');
  }

  try {
    db.exec("ALTER TABLE container_splits ADD COLUMN storage_mode TEXT");
  } catch (_e) {
    /* column already exists */
  }

  _initialized = true;
}

// =============================================================================
// Printers
// =============================================================================

export function listPrinters(activeOnly = true): Printer[] {
  ensureLabelingTables();
  const db = getDb();
  const sql = activeOnly
    ? 'SELECT * FROM printers WHERE active = 1 ORDER BY name'
    : 'SELECT * FROM printers ORDER BY name';
  return db.prepare(sql).all() as Printer[];
}

export function getPrinter(id: number): Printer | null {
  ensureLabelingTables();
  return getDb().prepare('SELECT * FROM printers WHERE id = ?').get(id) as Printer | null;
}

export function createPrinter(data: CreatePrinterRequest): number {
  ensureLabelingTables();
  const now = nowISO();
  const r = getDb().prepare(`
    INSERT INTO printers (name, ip_address, port, location_id, location_name, dpi,
      default_label_size_id, custom_width_mm, custom_height_mm, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    data.name, data.ip_address, data.port ?? 9100,
    data.location_id, data.location_name, data.dpi ?? 203,
    data.default_label_size_id ?? '4x4',
    data.custom_width_mm ?? null, data.custom_height_mm ?? null,
    now, now
  );
  return r.lastInsertRowid as number;
}

const ALLOWED_PRINTER_FIELDS = [
  'name', 'ip_address', 'port', 'location_id', 'location_name',
  'dpi', 'default_label_size_id', 'custom_width_mm', 'custom_height_mm',
  'active', 'updated_at',
];

export function updatePrinter(id: number, data: Partial<CreatePrinterRequest> & { active?: number }) {
  ensureLabelingTables();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const fields: Record<string, unknown> = { ...data, updated_at: nowISO() };
  // Only allow known column names to prevent SQL injection via key interpolation
  const safeEntries = Object.entries(fields).filter(([k]) => ALLOWED_PRINTER_FIELDS.includes(k));
  for (const [k, v] of safeEntries) {
    if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE printers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deletePrinter(id: number) {
  ensureLabelingTables();
  getDb().prepare('UPDATE printers SET active = 0, updated_at = ? WHERE id = ?').run(nowISO(), id);
}

// =============================================================================
// Container Splits
// =============================================================================

export function getSplitByMo(moId: number): ContainerSplit | null {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM container_splits WHERE mo_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(moId) as ContainerSplit | null;
}

export function getSplit(id: number): ContainerSplit | null {
  ensureLabelingTables();
  return getDb().prepare('SELECT * FROM container_splits WHERE id = ?').get(id) as ContainerSplit | null;
}

export function getContainers(splitId: number): Container[] {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM containers WHERE split_id = ? ORDER BY sequence'
  ).all(splitId) as Container[];
}

export function createSplit(
  data: CreateSplitRequest,
  userId: number,
  storageMode: 'chilled' | 'frozen' = 'chilled',
): { splitId: number; containerIds: number[] } {
  ensureLabelingTables();
  const db = getDb();
  const now = nowISO();

  const sr = db.prepare(`
    INSERT INTO container_splits (mo_id, mo_name, product_id, product_name, total_qty, uom, status, created_by, created_at, storage_mode)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(data.mo_id, data.mo_name, data.product_id, data.product_name, data.total_qty, data.uom, userId, now, storageMode);
  const splitId = sr.lastInsertRowid as number;

  const containerIds: number[] = [];
  const stmt = db.prepare(`
    INSERT INTO containers (split_id, sequence, qty, expiry_date, label_printed)
    VALUES (?, ?, ?, ?, 0)
  `);
  for (let i = 0; i < data.containers.length; i++) {
    const c = data.containers[i];
    const cr = stmt.run(splitId, i + 1, c.qty, c.expiry_date ?? null);
    containerIds.push(cr.lastInsertRowid as number);
  }
  return { splitId, containerIds };
}

export function confirmSplit(splitId: number) {
  ensureLabelingTables();
  getDb().prepare(
    "UPDATE container_splits SET status = 'confirmed', confirmed_at = ? WHERE id = ?"
  ).run(nowISO(), splitId);
}

export function markSplitPrinted(splitId: number) {
  ensureLabelingTables();
  getDb().prepare(
    "UPDATE container_splits SET status = 'printed' WHERE id = ?"
  ).run(splitId);
}

export function updateContainerLot(containerId: number, lotName: string, lotId: number) {
  ensureLabelingTables();
  getDb().prepare(
    'UPDATE containers SET lot_name = ?, lot_id = ? WHERE id = ?'
  ).run(lotName, lotId, containerId);
}

export function markContainerPrinted(containerId: number) {
  ensureLabelingTables();
  getDb().prepare(
    'UPDATE containers SET label_printed = 1, last_printed_at = ? WHERE id = ?'
  ).run(nowISO(), containerId);
}

// =============================================================================
// Print Jobs
// =============================================================================

export function createPrintJob(data: {
  container_id: number;
  printer_id: number;
  printer_name: string;
  label_size_id: string;
  label_width_mm: number;
  label_height_mm: number;
  zpl_content: string;
  printed_by: number;
  printed_by_name: string;
}): number {
  ensureLabelingTables();
  const r = getDb().prepare(`
    INSERT INTO print_jobs (container_id, printer_id, printer_name, label_size_id,
      label_width_mm, label_height_mm, zpl_content, status, printed_by, printed_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `).run(
    data.container_id, data.printer_id, data.printer_name, data.label_size_id,
    data.label_width_mm, data.label_height_mm, data.zpl_content,
    data.printed_by, data.printed_by_name, nowISO()
  );
  return r.lastInsertRowid as number;
}

export function updatePrintJobStatus(jobId: number, status: string, errorMessage?: string) {
  ensureLabelingTables();
  getDb().prepare(
    'UPDATE print_jobs SET status = ?, error_message = ? WHERE id = ?'
  ).run(status, errorMessage ?? null, jobId);
}

export function getPrintJobsForContainer(containerId: number): PrintJob[] {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM print_jobs WHERE container_id = ? ORDER BY created_at DESC'
  ).all(containerId) as PrintJob[];
}

export function getPrintJobsForSplit(splitId: number): PrintJob[] {
  ensureLabelingTables();
  return getDb().prepare(`
    SELECT pj.* FROM print_jobs pj
    JOIN containers c ON c.id = pj.container_id
    WHERE c.split_id = ?
    ORDER BY pj.created_at DESC
  `).all(splitId) as PrintJob[];
}

// =============================================================================
// Saved Label Sizes
// =============================================================================

export function getSavedLabelSizes(companyId: number): SavedCustomSize[] {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM saved_label_sizes WHERE company_id = ? ORDER BY name ASC'
  ).all(companyId) as SavedCustomSize[];
}

export function createSavedLabelSize(
  name: string, widthMm: number, heightMm: number,
  companyId: number, userId: number, userName: string
): SavedCustomSize {
  ensureLabelingTables();
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO saved_label_sizes (name, width_mm, height_mm, company_id, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, widthMm, heightMm, companyId, userId, userName);
  return db.prepare('SELECT * FROM saved_label_sizes WHERE id = ?').get(info.lastInsertRowid) as SavedCustomSize;
}

export function deleteSavedLabelSize(id: number, companyId: number): boolean {
  ensureLabelingTables();
  const db = getDb();
  // Clear any preferences referencing this saved size
  db.prepare(`
    UPDATE label_size_preferences SET size_type = 'preset', preset_id = '55x75', saved_size_id = NULL
    WHERE saved_size_id = ? AND company_id = ?
  `).run(id, companyId);
  const info = db.prepare('DELETE FROM saved_label_sizes WHERE id = ? AND company_id = ?').run(id, companyId);
  return info.changes > 0;
}

// =============================================================================
// Label Size Preferences
// =============================================================================

export function getLabelSizePreference(userId: number, companyId: number): LabelSizePreference | null {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM label_size_preferences WHERE user_id = ? AND company_id = ?'
  ).get(userId, companyId) as LabelSizePreference | null;
}

export function setLabelSizePreference(
  userId: number, companyId: number,
  sizeType: 'preset' | 'custom' | 'saved',
  presetId: string | null, savedSizeId: number | null,
  customWidthMm: number | null, customHeightMm: number | null
): LabelSizePreference {
  ensureLabelingTables();
  const db = getDb();
  db.prepare(`
    INSERT INTO label_size_preferences (user_id, company_id, size_type, preset_id, saved_size_id, custom_width_mm, custom_height_mm, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, company_id) DO UPDATE SET
      size_type = excluded.size_type,
      preset_id = excluded.preset_id,
      saved_size_id = excluded.saved_size_id,
      custom_width_mm = excluded.custom_width_mm,
      custom_height_mm = excluded.custom_height_mm,
      updated_at = datetime('now')
  `).run(userId, companyId, sizeType, presetId, savedSizeId, customWidthMm, customHeightMm);
  return getLabelSizePreference(userId, companyId)!;
}

// =============================================================================
// Custom Label Templates (saved presets for the Custom Labels screen)
// Dates are intentionally NOT saved — they're always re-entered at print time.
// =============================================================================

export interface CustomLabelTemplate {
  id: number;
  product_name: string;
  qty: number | null;
  uom: string | null;
  label_count: number | null;
  company_id: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export function getCustomLabelTemplates(companyId: number): CustomLabelTemplate[] {
  ensureLabelingTables();
  return getDb().prepare(
    'SELECT * FROM custom_label_templates WHERE company_id = ? ORDER BY updated_at DESC'
  ).all(companyId) as CustomLabelTemplate[];
}

export function upsertCustomLabelTemplate(
  productName: string,
  qty: number | null,
  uom: string | null,
  labelCount: number | null,
  companyId: number,
  userId: number,
  userName: string,
): CustomLabelTemplate {
  ensureLabelingTables();
  const db = getDb();
  db.prepare(`
    INSERT INTO custom_label_templates (product_name, qty, uom, label_count, company_id, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_name, company_id) DO UPDATE SET
      qty = excluded.qty,
      uom = excluded.uom,
      label_count = excluded.label_count,
      updated_at = datetime('now')
  `).run(productName, qty, uom, labelCount, companyId, userId, userName);
  return db.prepare(
    'SELECT * FROM custom_label_templates WHERE product_name = ? AND company_id = ?'
  ).get(productName, companyId) as CustomLabelTemplate;
}

export function deleteCustomLabelTemplate(id: number, companyId: number): boolean {
  ensureLabelingTables();
  const info = getDb().prepare(
    'DELETE FROM custom_label_templates WHERE id = ? AND company_id = ?'
  ).run(id, companyId);
  return info.changes > 0;
}
