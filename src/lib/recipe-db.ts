/**
 * Krawings Recipe Guide — SQLite database layer
 *
 * Handles local storage for:
 * - Locally-created recipes (pre-Odoo sync)
 * - Recording drafts
 * - Sync queue
 * - Cook session logs
 *
 * Recipe steps and images live in Odoo (source of truth).
 * SQLite is only a cache and offline buffer.
 */
import { getDb } from './db';
import type {
  LocalRecipe,
  RecordingDraft,
  SyncQueueItem,
  CookSession,
  RecipeMode,
} from '../types/recipe';

// -- Schema --

export function initRecipeTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('cooking_guide', 'production_guide')),
      category_name TEXT NOT NULL DEFAULT '',
      base_servings INTEGER NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'servings',
      ingredients_json TEXT NOT NULL DEFAULT '[]',
      odoo_id INTEGER,
      odoo_synced INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recording_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_mode TEXT NOT NULL CHECK(recipe_mode IN ('cooking_guide', 'production_guide')),
      recipe_name TEXT NOT NULL,
      product_tmpl_id INTEGER,
      bom_id INTEGER,
      local_recipe_id INTEGER REFERENCES local_recipes(id),
      steps_json TEXT NOT NULL DEFAULT '[]',
      total_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'done', 'submitted')),
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipe_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cook_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_mode TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      product_tmpl_id INTEGER,
      bom_id INTEGER,
      batch_size REAL NOT NULL DEFAULT 1,
      batch_unit TEXT NOT NULL DEFAULT 'servings',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      total_seconds INTEGER NOT NULL DEFAULT 0,
      cooked_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned'))
    );
  `);
}

// -- Local Recipes --

export function createLocalRecipe(data: {
  name: string;
  mode: RecipeMode;
  category_name: string;
  base_servings: number;
  unit: string;
  ingredients_json: string;
  created_by: number;
}): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO local_recipes (name, mode, category_name, base_servings, unit, ingredients_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.name, data.mode, data.category_name,
    data.base_servings, data.unit, data.ingredients_json,
    data.created_by,
  );
  queueSync('create_recipe', JSON.stringify({ local_id: result.lastInsertRowid }));
  return Number(result.lastInsertRowid);
}

export function getLocalRecipes(mode?: RecipeMode): LocalRecipe[] {
  const db = getDb();
  if (mode) {
    return db.prepare('SELECT * FROM local_recipes WHERE mode = ? ORDER BY created_at DESC').all(mode) as LocalRecipe[];
  }
  return db.prepare('SELECT * FROM local_recipes ORDER BY created_at DESC').all() as LocalRecipe[];
}

export function getUnsyncedRecipes(): LocalRecipe[] {
  const db = getDb();
  return db.prepare('SELECT * FROM local_recipes WHERE odoo_synced = 0').all() as LocalRecipe[];
}

export function markRecipeSynced(localId: number, odooId: number): void {
  const db = getDb();
  db.prepare('UPDATE local_recipes SET odoo_id = ?, odoo_synced = 1, updated_at = datetime(\'now\') WHERE id = ?')
    .run(odooId, localId);
}

// -- Recording Drafts --

export function createRecordingDraft(data: {
  recipe_mode: RecipeMode;
  recipe_name: string;
  product_tmpl_id?: number | null;
  bom_id?: number | null;
  local_recipe_id?: number | null;
  created_by: number;
}): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO recording_drafts (recipe_mode, recipe_name, product_tmpl_id, bom_id, local_recipe_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.recipe_mode, data.recipe_name,
    data.product_tmpl_id ?? null, data.bom_id ?? null,
    data.local_recipe_id ?? null, data.created_by,
  );
  return Number(result.lastInsertRowid);
}

export function updateRecordingDraft(id: number, data: {
  steps_json?: string;
  total_seconds?: number;
  status?: 'recording' | 'done' | 'submitted';
}): void {
  const db = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const vals: any[] = [];
  if (data.steps_json !== undefined) { sets.push('steps_json = ?'); vals.push(data.steps_json); }
  if (data.total_seconds !== undefined) { sets.push('total_seconds = ?'); vals.push(data.total_seconds); }
  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  vals.push(id);
  db.prepare(`UPDATE recording_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getRecordingDrafts(userId?: number): RecordingDraft[] {
  const db = getDb();
  if (userId) {
    return db.prepare('SELECT * FROM recording_drafts WHERE created_by = ? AND status != \'submitted\' ORDER BY updated_at DESC').all(userId) as RecordingDraft[];
  }
  return db.prepare('SELECT * FROM recording_drafts WHERE status != \'submitted\' ORDER BY updated_at DESC').all() as RecordingDraft[];
}

export function getRecordingDraft(id: number): RecordingDraft | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM recording_drafts WHERE id = ?').get(id) as RecordingDraft) ?? null;
}

export function deleteRecordingDraft(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM recording_drafts WHERE id = ?').run(id);
}

// -- Sync Queue --

export function queueSync(action: string, payloadJson: string): number {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO recipe_sync_queue (action, payload_json) VALUES (?, ?)'
  ).run(action, payloadJson);
  return Number(result.lastInsertRowid);
}

export function getPendingSyncItems(): SyncQueueItem[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM recipe_sync_queue WHERE status IN (\'pending\', \'failed\') AND attempts < 5 ORDER BY created_at ASC'
  ).all() as SyncQueueItem[];
}

export function updateSyncItem(id: number, status: string, error?: string): void {
  const db = getDb();
  db.prepare(
    'UPDATE recipe_sync_queue SET status = ?, error = ?, attempts = attempts + 1 WHERE id = ?'
  ).run(status, error ?? null, id);
}

export function getSyncQueueCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM recipe_sync_queue WHERE status = \'pending\'').get() as { cnt: number };
  return row?.cnt ?? 0;
}

// -- Cook Sessions --

export function startCookSession(data: {
  recipe_mode: RecipeMode;
  recipe_name: string;
  product_tmpl_id?: number | null;
  bom_id?: number | null;
  batch_size: number;
  batch_unit: string;
  cooked_by: number;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO cook_sessions (recipe_mode, recipe_name, product_tmpl_id, bom_id, batch_size, batch_unit, cooked_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.recipe_mode, data.recipe_name,
    data.product_tmpl_id ?? null, data.bom_id ?? null,
    data.batch_size, data.batch_unit, data.cooked_by,
  );
  return Number(result.lastInsertRowid);
}

export function completeCookSession(id: number, totalSeconds: number): void {
  const db = getDb();
  db.prepare(
    'UPDATE cook_sessions SET status = \'completed\', completed_at = datetime(\'now\'), total_seconds = ? WHERE id = ?'
  ).run(totalSeconds, id);
}

export function abandonCookSession(id: number): void {
  const db = getDb();
  db.prepare('UPDATE cook_sessions SET status = \'abandoned\' WHERE id = ?').run(id);
}

export function getRecentCookSessions(limit: number = 20): CookSession[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM cook_sessions ORDER BY started_at DESC LIMIT ?'
  ).all(limit) as CookSession[];
}
