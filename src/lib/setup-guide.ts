/**
 * setup-guide.ts
 * Data-layer helpers for the Mise en place "Station Setup Guide" feature of the
 * Department Task Manager. Backed by the `krawings_task_manager` addon:
 *   - krawings.task.item             (per-department station-item catalog)
 *   - krawings.task.template.line    (reference photo via set/get_setup_photo)
 *   - krawings.task.list.line        (per-day photo snapshot via get_setup_photo)
 *
 * All calls go through getOdoo() (server-side only, like the rest of odoo-tasks.ts).
 */

import { getOdoo } from './odoo';

export interface StationItem {
  id: number;
  name: string;
}

export interface SetupPhotoBytes {
  filename: string;
  mimetype: string;
  data_base64: string;
}

// ── Per-department item catalog ───────────────────────────────

export async function listStationItems(departmentId: number): Promise<StationItem[]> {
  if (!departmentId) return [];
  const rows: any[] = await getOdoo().call(
    'krawings.task.item', 'list_for_department', [departmentId],
  );
  return (rows || []).map(r => ({ id: r.id, name: r.name }));
}

/** Idempotent add — re-adding an existing name returns it; an archived one is reactivated. */
export async function addStationItem(departmentId: number, name: string): Promise<StationItem> {
  const r: any = await getOdoo().call(
    'krawings.task.item', 'add_for_department', [departmentId, name],
  );
  return { id: r.id, name: r.name };
}

/** Rename an item; propagates the new label to linked template pins (future spawns). */
export async function renameStationItem(itemId: number, newName: string): Promise<StationItem> {
  const r: any = await getOdoo().call('krawings.task.item', 'rename', [[itemId], newName]);
  return { id: r.id, name: r.name };
}

export async function deactivateStationItem(itemId: number): Promise<void> {
  await getOdoo().call('krawings.task.item', 'deactivate', [[itemId]]);
}

// ── Reference photo (template) + per-day snapshot (daily line) ─

/** Store/replace a template line's reference photo. `clearPins` drops old pins (coords stale on a new image). */
export async function setTemplateLineSetupPhoto(
  templateLineId: number,
  base64: string,
  filename: string,
  clearPins = false,
): Promise<void> {
  await getOdoo().call(
    'krawings.task.template.line', 'set_setup_photo',
    [[templateLineId], base64, filename, clearPins],
  );
}

/** Remove a template line's reference photo (and, if requested, its pins). */
export async function clearTemplateLineSetupPhoto(templateLineId: number, clearPins = false): Promise<void> {
  await getOdoo().call(
    'krawings.task.template.line', 'set_setup_photo',
    [[templateLineId], false, false, clearPins],
  );
}

export async function getTemplateSetupPhoto(
  templateLineId: number,
  allowedCompanyIds: number[] = [],
): Promise<SetupPhotoBytes | null> {
  const r: any = await getOdoo().call(
    'krawings.task.template.line', 'get_setup_photo', [templateLineId, allowedCompanyIds],
  );
  return r || null;
}

export async function getListLineSetupPhoto(
  listLineId: number,
  allowedCompanyIds: number[] = [],
): Promise<SetupPhotoBytes | null> {
  const r: any = await getOdoo().call(
    'krawings.task.list.line', 'get_setup_photo', [listLineId, allowedCompanyIds],
  );
  return r || null;
}
