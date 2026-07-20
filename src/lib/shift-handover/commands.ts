/**
 * Shift Handover — transactional commands (business logic).
 *
 * Every mutation goes through here so validation (states.ts), the canonical
 * audit log (handover_events), and persistence (db.ts) can never drift apart.
 * The submit path builds a normalized, hashed, trigger-protected snapshot inside
 * one transaction so a locked handover cannot be silently changed.
 */
import { getCountLocation } from '@/lib/inventory-db';
import { validateContainer, containerLabel, type ValidationError } from './states';
import { buildHandoverSections, computeSnapshotHash, type PreviewContainer, type PreviewAction } from './snapshot';
import type { HandoverActor } from './access';
import {
  getDb, nowISO,
  getHandoverProduct,
  getContainerType,
  createBatch, getBatch,
  createContainer, getContainer, listContainersByBatch, listContainers, updateContainer,
  addPhoto, countActivePhotos, listPhotos, deactivatePhoto, getPhoto,
  createAction, getAction, updateAction, listActions,
  createHandover, getHandover, findActiveHandover, updateHandoverRow,
  insertSnapshotContainer, insertSnapshotAction,
  createDiscrepancy, resolveDiscrepancy, getDiscrepancy,
  snapshotContainerBelongs,
  logHandoverEvent,
  getIdempotentResult, putIdempotentResult,
} from './db';
import type { HandoverContainer } from './types';

// ── Photo + reference validation (Codex review hardening) ────────────────────
const MAX_PHOTO_CHARS = 8_000_000; // ~6 MB decoded

/**
 * A real image data-URL of an allowed type, within the size cap. Base64 must be
 * contiguous (no whitespace) with an actual payload — a 1x1 PNG is ~68 chars, so
 * anything under 32 (incl. empty / whitespace-only) is rejected. This closes the
 * `data:image/png;base64, ` mandatory-photo bypass.
 */
export function isValidPhoto(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > MAX_PHOTO_CHARS) return false;
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  return !!m && m[2].length >= 32 && m[2].length % 4 === 0;
}
function validPhotos(arr: unknown): string[] {
  return Array.isArray(arr) ? arr.filter(isValidPhoto) : [];
}

/** Thrown inside a write transaction to roll it back and surface a 409. */
class ConflictError extends Error {}

/** container_type_id + storage_location_id must belong to this company (or be null). */
function scopedRefsOk(companyId: number, containerTypeId?: number | null, storageLocationId?: number | null): boolean {
  if (containerTypeId != null) { const t = getContainerType(containerTypeId); if (!t || t.company_id !== companyId) return false; }
  if (storageLocationId != null) { const l = getCountLocation(storageLocationId); if (!l || l.company_id !== companyId) return false; }
  return true;
}

export type CmdResult<T> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; validation?: Array<{ index: number; errors: ValidationError[] }> };

// ── Container input ──────────────────────────────────────────────────────────
export interface ContainerInput {
  container_type_id?: number | null;
  fill_level?: number | null;
  quantity_method?: string | null;
  exact_quantity?: number | null;
  unit?: string | null;
  preparation_state: string;
  availability_state?: string | null;
  storage_location_id?: number | null;
  use_first?: boolean;
  next_action?: string | null;
  note?: string | null;
  photos?: string[];
  photo_captions?: string[];
  /** Fast-entry: create N identical containers (default 1). */
  count?: number;
}

function locationName(id: number | null | undefined): string | null {
  if (id == null) return null;
  return getCountLocation(id)?.name ?? null;
}

/** Expand a container spec's fast-entry `count` into individual specs. */
function expand(inputs: ContainerInput[]): ContainerInput[] {
  const out: ContainerInput[] = [];
  for (const c of inputs) {
    const n = Math.max(1, Math.min(Math.floor(c.count ?? 1), 50));
    for (let i = 0; i < n; i++) out.push({ ...c, count: 1 });
  }
  return out;
}

// ── Record a batch with N containers ─────────────────────────────────────────
export function recordBatch(
  companyId: number,
  actor: HandoverActor,
  input: {
    operational_date: string;
    product_id: number;
    shift_label?: string | null;
    note?: string | null;
    containers: ContainerInput[];
  },
): CmdResult<{ batch_id: number; container_ids: number[] }> {
  const product = getHandoverProduct(input.product_id);
  if (!product || product.company_id !== companyId) {
    return { ok: false, status: 400, error: 'Choose a valid product.' };
  }
  const specs = expand(input.containers ?? []);
  if (specs.length === 0) return { ok: false, status: 400, error: 'Add at least one container.' };

  // Validate every container BEFORE writing anything.
  const validation: Array<{ index: number; errors: ValidationError[] }> = [];
  specs.forEach((c, i) => {
    const res = validateContainer({
      status: 'active',
      preparation_state: c.preparation_state ?? null,
      availability_state: c.availability_state ?? 'not_ready',
      storage_location_id: c.storage_location_id ?? null,
      fill_level: c.fill_level ?? null,
      quantity_method: c.quantity_method ?? null,
      photo_count: validPhotos(c.photos).length, // only real images count toward a mandatory rule
      photo_policy: product.photo_policy,
    });
    const errors = [...res.errors];
    if (!scopedRefsOk(companyId, c.container_type_id, c.storage_location_id)) {
      errors.push({ code: 'INVALID_REFERENCE', message: 'That container type or location is not available for this restaurant.' });
    }
    if (errors.length) validation.push({ index: i, errors });
  });
  if (validation.length) return { ok: false, status: 422, error: 'Some containers need fixing.', validation };

  const db = getDb();
  const tx = db.transaction(() => {
    const batchId = createBatch({
      company_id: companyId,
      operational_date: input.operational_date,
      product_id: product.id,
      product_name: product.name,
      shift_label: input.shift_label ?? null,
      produced_by_user_id: actor.userId,
      produced_by_name: actor.name,
      note: input.note ?? null,
    });
    const ids: number[] = [];
    specs.forEach((c, i) => {
      const cid = createContainer({
        company_id: companyId,
        batch_id: batchId,
        product_id: product.id,
        container_code: containerLabel(i),
        container_type_id: c.container_type_id ?? null,
        fill_level: c.fill_level ?? null,
        quantity_method: c.quantity_method ?? null,
        exact_quantity: c.exact_quantity ?? null,
        unit: c.unit ?? product.unit ?? null,
        preparation_state: c.preparation_state,
        availability_state: c.availability_state ?? 'not_ready',
        storage_location_id: c.storage_location_id ?? null,
        use_first: !!c.use_first,
        next_action: c.next_action ?? null,
        note: c.note ?? null,
        created_by_user_id: actor.userId,
        created_by_name: actor.name,
      });
      validPhotos(c.photos).forEach((photo, pi) => addPhoto({
        company_id: companyId, entity_type: 'container', entity_id: cid, event: 'production',
        photo, caption: c.photo_captions?.[pi] ?? null,
        uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name,
      }));
      if (c.next_action) {
        createAction({
          company_id: companyId, operational_date: input.operational_date, batch_id: batchId, container_id: cid,
          instruction: c.next_action, priority: 'normal',
          created_by_user_id: actor.userId, created_by_name: actor.name,
        });
      }
      ids.push(cid);
    });
    logHandoverEvent({
      company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
      entity_type: 'batch', entity_id: batchId, action: 'batch.recorded',
      after: { product: product.name, containers: ids.length }, operational_date: input.operational_date,
    });
    return { batchId, ids };
  });

  const { batchId, ids } = tx();
  return { ok: true, batch_id: batchId, container_ids: ids };
}

// ── Add containers to an existing batch ──────────────────────────────────────
export function addContainersToBatch(
  companyId: number, actor: HandoverActor, batchId: number, containers: ContainerInput[],
): CmdResult<{ container_ids: number[] }> {
  const batch = getBatch(batchId);
  if (!batch || batch.company_id !== companyId) return { ok: false, status: 404, error: 'Batch not found.' };
  const product = getHandoverProduct(batch.product_id);
  const specs = expand(containers ?? []);
  if (specs.length === 0) return { ok: false, status: 400, error: 'Add at least one container.' };

  const validation: Array<{ index: number; errors: ValidationError[] }> = [];
  specs.forEach((c, i) => {
    const res = validateContainer({
      status: 'active', preparation_state: c.preparation_state ?? null,
      availability_state: c.availability_state ?? 'not_ready', storage_location_id: c.storage_location_id ?? null,
      fill_level: c.fill_level ?? null, quantity_method: c.quantity_method ?? null,
      photo_count: validPhotos(c.photos).length, photo_policy: product?.photo_policy,
    });
    const errors = [...res.errors];
    if (!scopedRefsOk(companyId, c.container_type_id, c.storage_location_id)) {
      errors.push({ code: 'INVALID_REFERENCE', message: 'That container type or location is not available for this restaurant.' });
    }
    if (errors.length) validation.push({ index: i, errors });
  });
  if (validation.length) return { ok: false, status: 422, error: 'Some containers need fixing.', validation };

  const existing = listContainersByBatch(batchId);
  const startIndex = existing.length;

  const db = getDb();
  const tx = db.transaction(() => {
    const ids: number[] = [];
    specs.forEach((c, i) => {
      const cid = createContainer({
        company_id: companyId, batch_id: batchId, product_id: batch.product_id,
        container_code: containerLabel(startIndex + i), container_type_id: c.container_type_id ?? null,
        fill_level: c.fill_level ?? null, quantity_method: c.quantity_method ?? null,
        exact_quantity: c.exact_quantity ?? null, unit: c.unit ?? product?.unit ?? null,
        preparation_state: c.preparation_state, availability_state: c.availability_state ?? 'not_ready',
        storage_location_id: c.storage_location_id ?? null, use_first: !!c.use_first,
        next_action: c.next_action ?? null, note: c.note ?? null,
        created_by_user_id: actor.userId, created_by_name: actor.name,
      });
      validPhotos(c.photos).forEach((photo, pi) => addPhoto({
        company_id: companyId, entity_type: 'container', entity_id: cid, event: 'production',
        photo, caption: c.photo_captions?.[pi] ?? null, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name,
      }));
      ids.push(cid);
    });
    logHandoverEvent({
      company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
      entity_type: 'batch', entity_id: batchId, action: 'batch.containers_added',
      after: { added: ids.length }, operational_date: batch.operational_date,
    });
    return ids;
  });
  return { ok: true, container_ids: tx() };
}

// ── Update a single container (validated) ────────────────────────────────────
export function updateContainerCmd(
  companyId: number, actor: HandoverActor, containerId: number,
  patch: Partial<ContainerInput> & { status?: string },
): CmdResult<{ container: HandoverContainer }> {
  const current = getContainer(containerId);
  if (!current || current.company_id !== companyId) return { ok: false, status: 404, error: 'Container not found.' };
  const product = getHandoverProduct(current.product_id);

  const merged = {
    status: patch.status ?? current.status,
    preparation_state: patch.preparation_state !== undefined ? patch.preparation_state : current.preparation_state,
    availability_state: patch.availability_state !== undefined ? patch.availability_state : current.availability_state,
    storage_location_id: patch.storage_location_id !== undefined ? patch.storage_location_id : current.storage_location_id,
    fill_level: patch.fill_level !== undefined ? patch.fill_level : current.fill_level,
    quantity_method: patch.quantity_method !== undefined ? patch.quantity_method : current.quantity_method,
  };
  const res = validateContainer({
    ...merged,
    photo_count: countActivePhotos('container', containerId),
    photo_policy: product?.photo_policy,
  });
  if (!res.ok) return { ok: false, status: 422, error: 'That change isn’t allowed.', validation: [{ index: 0, errors: res.errors }] };
  if (!scopedRefsOk(companyId, patch.container_type_id ?? current.container_type_id, merged.storage_location_id)) {
    return { ok: false, status: 422, error: 'That container type or location is not available for this restaurant.' };
  }

  const before = { ...current };
  updateContainer(containerId, companyId, {
    container_type_id: patch.container_type_id,
    fill_level: patch.fill_level,
    quantity_method: patch.quantity_method,
    exact_quantity: patch.exact_quantity,
    unit: patch.unit,
    preparation_state: patch.preparation_state,
    availability_state: patch.availability_state,
    storage_location_id: patch.storage_location_id,
    use_first: patch.use_first,
    next_action: patch.next_action,
    note: patch.note,
    status: patch.status,
  });
  const after = getContainer(containerId)!;
  logHandoverEvent({
    company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
    entity_type: 'container', entity_id: containerId, action: 'container.updated',
    before: { storage_location_id: before.storage_location_id, fill_level: before.fill_level, preparation_state: before.preparation_state, availability_state: before.availability_state, use_first: before.use_first, status: before.status },
    after: { storage_location_id: after.storage_location_id, fill_level: after.fill_level, preparation_state: after.preparation_state, availability_state: after.availability_state, use_first: after.use_first, status: after.status },
    operational_date: getBatch(current.batch_id)?.operational_date ?? null,
  });
  return { ok: true, container: after };
}

// ── Photos ───────────────────────────────────────────────────────────────────
export function addContainerPhoto(
  companyId: number, actor: HandoverActor, containerId: number, photo: string, caption: string | null, event = 'general',
): CmdResult<{ photo_id: number }> {
  const c = getContainer(containerId);
  if (!c || c.company_id !== companyId) return { ok: false, status: 404, error: 'Container not found.' };
  if (!isValidPhoto(photo)) return { ok: false, status: 400, error: 'A valid image (under the size limit) is required.' };
  const id = addPhoto({ company_id: companyId, entity_type: 'container', entity_id: containerId, event, photo, caption, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name });
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'container', entity_id: containerId, action: 'container.photo_added' });
  return { ok: true, photo_id: id };
}

export function replaceContainerPhoto(
  companyId: number, actor: HandoverActor, containerId: number, oldPhotoId: number, photo: string, caption: string | null,
): CmdResult<{ photo_id: number }> {
  const old = getPhoto(oldPhotoId);
  // The photo being replaced must be an ACTIVE photo OF THIS container in THIS
  // company — you can't touch another entity's (or another container's) photo.
  if (!old || old.company_id !== companyId || old.entity_type !== 'container' || old.entity_id !== containerId || !old.active) {
    return { ok: false, status: 404, error: 'Photo not found on this container.' };
  }
  if (!isValidPhoto(photo)) return { ok: false, status: 400, error: 'A valid image (under the size limit) is required.' };
  const id = addPhoto({ company_id: companyId, entity_type: 'container', entity_id: containerId, event: old.event, photo, caption, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name, replaced_photo_id: oldPhotoId });
  deactivatePhoto(oldPhotoId, companyId); // soft — history preserved
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'container', entity_id: containerId, action: 'photo.replaced', before: { photo_id: oldPhotoId }, after: { photo_id: id } });
  return { ok: true, photo_id: id };
}

// ── Actions / tasks ──────────────────────────────────────────────────────────
export function createActionCmd(
  companyId: number, actor: HandoverActor, input: {
    operational_date: string; instruction: string; priority?: string; assigned_role?: string | null;
    due_at?: string | null; batch_id?: number | null; container_id?: number | null; handover_id?: number | null;
  },
): CmdResult<{ action_id: number }> {
  if (!input.instruction?.trim()) return { ok: false, status: 400, error: 'Describe what needs to happen.' };
  // Any linked batch / container / handover must belong to this restaurant.
  if (input.batch_id != null && getBatch(input.batch_id)?.company_id !== companyId) return { ok: false, status: 400, error: 'Unknown batch.' };
  if (input.container_id != null && getContainer(input.container_id)?.company_id !== companyId) return { ok: false, status: 400, error: 'Unknown container.' };
  if (input.handover_id != null && getHandover(input.handover_id)?.company_id !== companyId) return { ok: false, status: 400, error: 'Unknown handover.' };
  const id = createAction({
    company_id: companyId, operational_date: input.operational_date, instruction: input.instruction.trim(),
    priority: input.priority || 'normal', assigned_role: input.assigned_role ?? null, due_at: input.due_at ?? null,
    batch_id: input.batch_id ?? null, container_id: input.container_id ?? null, handover_id: input.handover_id ?? null,
    created_by_user_id: actor.userId, created_by_name: actor.name,
  });
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'action', entity_id: id, action: 'action.created', after: { instruction: input.instruction, priority: input.priority }, operational_date: input.operational_date });
  return { ok: true, action_id: id };
}

export function completeActionCmd(
  companyId: number, actor: HandoverActor, actionId: number, note: string | null, photo?: string | null,
): CmdResult<{ action_id: number }> {
  const a = getAction(actionId);
  if (!a || a.company_id !== companyId) return { ok: false, status: 404, error: 'Task not found.' };
  let photoId: number | null = null;
  if (isValidPhoto(photo)) {
    photoId = addPhoto({ company_id: companyId, entity_type: 'action', entity_id: actionId, event: 'completion', photo: photo as string, caption: null, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name });
  }
  updateAction(actionId, companyId, { status: 'done', completed_by_user_id: actor.userId, completed_by_name: actor.name, completed_at: nowISO(), completion_note: note, completion_photo_id: photoId });
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'action', entity_id: actionId, action: 'action.completed', operational_date: a.operational_date });
  return { ok: true, action_id: actionId };
}

export function updateActionCmd(
  companyId: number, actor: HandoverActor, actionId: number,
  patch: Partial<{ instruction: string; priority: string; assigned_role: string | null; due_at: string | null; status: string }>,
): CmdResult<{ action_id: number }> {
  const a = getAction(actionId);
  if (!a || a.company_id !== companyId) return { ok: false, status: 404, error: 'Task not found.' };
  updateAction(actionId, companyId, patch);
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'action', entity_id: actionId, action: 'action.updated', before: { priority: a.priority, status: a.status }, after: patch, operational_date: a.operational_date });
  return { ok: true, action_id: actionId };
}

// ── Live preview → PreviewContainer/Action ───────────────────────────────────
function toPreviewContainer(c: HandoverContainer): PreviewContainer {
  const ct = c.container_type_id ? getContainerType(c.container_type_id) : null;
  const product = getHandoverProduct(c.product_id);
  return {
    id: c.id, batch_id: c.batch_id, product_id: c.product_id,
    product_name: product?.name ?? '', product_kind: product?.kind ?? 'finished',
    container_code: c.container_code, container_type_name: ct?.name ?? null,
    fill_level: c.fill_level, preparation_state: c.preparation_state, availability_state: c.availability_state,
    storage_location_id: c.storage_location_id, storage_location_name: locationName(c.storage_location_id),
    use_first: c.use_first, next_action: c.next_action, status: c.status,
  };
}

export function liveContainersForDate(companyId: number, operationalDate: string): PreviewContainer[] {
  return listContainers([companyId], { operational_date: operationalDate, status: 'active' }).map(toPreviewContainer);
}

export function liveActionsForDate(companyId: number, operationalDate: string): PreviewAction[] {
  return listActions([companyId], { operational_date: operationalDate })
    .filter((a) => a.status === 'open' || a.status === 'in_progress')
    .map((a) => ({ id: a.id, instruction: a.instruction, priority: a.priority, status: a.status, due_at: a.due_at, container_id: a.container_id, batch_id: a.batch_id }));
}

// ── Submit handover (immutable snapshot) ─────────────────────────────────────
export function submitHandover(
  companyId: number, actor: HandoverActor,
  input: { operational_date: string; outgoing_shift_label?: string | null; incoming_shift_label?: string | null; summary_note?: string | null },
  idempotencyKey?: string | null,
): CmdResult<{ handover_id: number; snapshot_hash: string }> {
  if (idempotencyKey) {
    const prior = getIdempotentResult(idempotencyKey, companyId, 'submit');
    if (prior) {
      const h = getHandover(prior);
      if (h) return { ok: true, handover_id: h.id, snapshot_hash: h.snapshot_hash ?? '' };
    }
  }

  const db = getDb();
  // IMMEDIATE write transaction — take the write lock up front to serialize
  // concurrent submits for the same shift boundary.
  const tx = db.transaction((): CmdResult<{ handover_id: number; snapshot_hash: string }> => {
    // Re-read live data INSIDE the transaction so nothing slips between preview
    // and submit.
    const containers = listContainers([companyId], { operational_date: input.operational_date, status: 'active' });
    const previewContainers = containers.map(toPreviewContainer);
    const previewActions = liveActionsForDate(companyId, input.operational_date);
    const sections = buildHandoverSections(previewContainers, previewActions);

    // Section lookup so each snapshot row records where it was shown.
    const sectionOf = new Map<number, string>();
    (['ready_for_service', 'backup_stock', 'in_production_or_cooling', 'on_hold_or_discrepancy'] as const)
      .forEach((k) => sections[k].forEach((c) => sectionOf.set(c.id, k)));

    let handover = findActiveHandover(companyId, input.operational_date, input.outgoing_shift_label ?? null);
    if (!handover) {
      const id = createHandover({
        company_id: companyId, operational_date: input.operational_date,
        outgoing_shift_label: input.outgoing_shift_label ?? null, incoming_shift_label: input.incoming_shift_label ?? null,
        summary_note: input.summary_note ?? null, created_by_user_id: actor.userId,
      });
      handover = getHandover(id)!;
    }
    if (handover.status !== 'draft') {
      return { ok: false, status: 409, error: 'This handover has already been submitted.' };
    }

    // Freeze the snapshot rows.
    const snapshotPayload: unknown[] = [];
    for (const c of containers) {
      const pc = previewContainers.find((p) => p.id === c.id)!;
      const photos = listPhotos('container', c.id).map((p) => ({ id: p.id, caption: p.caption }));
      const row = {
        handover_id: handover.id, company_id: companyId, container_id: c.id, batch_id: c.batch_id,
        product_name: pc.product_name, product_kind: pc.product_kind, container_code: pc.container_code,
        container_type_name: pc.container_type_name, fill_level: pc.fill_level,
        preparation_state: pc.preparation_state, availability_state: pc.availability_state,
        storage_location_id: pc.storage_location_id, storage_location_name: pc.storage_location_name,
        use_first: pc.use_first, next_action: pc.next_action, recorded_by_name: c.created_by_name,
        recorded_at: c.created_at, photos_json: JSON.stringify(photos), section: sectionOf.get(c.id) ?? 'other',
      };
      insertSnapshotContainer(row);
      snapshotPayload.push(row);
    }
    for (const a of previewActions) {
      const src = getAction(a.id);
      const cont = a.container_id ? getContainer(a.container_id) : null;
      const prod = cont ? getHandoverProduct(cont.product_id) : null;
      const row = {
        handover_id: handover.id, company_id: companyId, action_id: a.id, instruction: a.instruction,
        priority: a.priority, status: a.status, due_at: a.due_at,
        container_code: cont?.container_code ?? null, product_name: prod?.name ?? null,
      };
      insertSnapshotAction(row);
      snapshotPayload.push({ __action: true, ...row, src_priority: src?.priority });
    }

    const snapshot_hash = computeSnapshotHash({ containers: snapshotPayload });
    // Compare-and-swap on version — with the IMMEDIATE lock held this cannot fail
    // spuriously, but if it ever does we roll the whole snapshot back rather than
    // report a false success.
    const applied = updateHandoverRow(handover.id, companyId, {
      status: 'submitted', submitted_by_user_id: actor.userId, submitted_by_name: actor.name,
      submitted_at: nowISO(), snapshot_hash,
      incoming_shift_label: input.incoming_shift_label ?? handover.incoming_shift_label,
      summary_note: input.summary_note ?? handover.summary_note,
    }, handover.version);
    if (!applied) throw new ConflictError();

    logHandoverEvent({
      company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
      entity_type: 'handover', entity_id: handover.id, action: 'handover.submitted',
      after: { containers: containers.length, actions: previewActions.length, snapshot_hash }, operational_date: input.operational_date,
    });
    if (idempotencyKey) putIdempotentResult(idempotencyKey, companyId, 'submit', handover.id);
    return { ok: true, handover_id: handover.id, snapshot_hash };
  });

  try {
    return tx.immediate();
  } catch (e) {
    if (e instanceof ConflictError) return { ok: false, status: 409, error: 'This handover was just submitted by someone else.' };
    throw e;
  }
}

// ── Acknowledge (incoming shift) ─────────────────────────────────────────────
export interface DiscrepancyInput {
  discrepancy_type: string;
  snapshot_container_id?: number | null;
  expected_value?: string | null;
  reported_value?: string | null;
  note?: string | null;
  photo?: string | null;
}

export function acknowledgeHandover(
  companyId: number, actor: HandoverActor, handoverId: number,
  input: { outcome?: string | null; note?: string | null; discrepancies?: DiscrepancyInput[] },
  idempotencyKey?: string | null,
): CmdResult<{ handover_id: number; status: string }> {
  if (idempotencyKey) {
    const prior = getIdempotentResult(idempotencyKey, companyId, 'ack');
    if (prior) { const h = getHandover(prior); if (h) return { ok: true, handover_id: h.id, status: h.status }; }
  }
  const db = getDb();
  const tx = db.transaction((): CmdResult<{ handover_id: number; status: string }> => {
    const h = getHandover(handoverId);
    if (!h || h.company_id !== companyId) return { ok: false, status: 404, error: 'Handover not found.' };
    if (h.status !== 'submitted') return { ok: false, status: 409, error: 'This handover is not awaiting acknowledgement.' };

    const discs = input.discrepancies ?? [];
    const hasDiscrepancies = discs.some((d) => d.discrepancy_type && d.discrepancy_type !== 'confirmed');
    const newStatus = hasDiscrepancies ? 'acknowledged_with_discrepancies' : 'acknowledged';

    // CAS on version — a second acknowledger loses.
    const applied = updateHandoverRow(handoverId, companyId, {
      status: newStatus, acknowledged_by_user_id: actor.userId, acknowledged_by_name: actor.name,
      acknowledged_at: nowISO(), ack_outcome: input.outcome ?? (hasDiscrepancies ? 'discrepancy' : 'confirmed'),
    }, h.version);
    if (!applied) return { ok: false, status: 409, error: 'Someone else just acknowledged this handover.' };

    for (const d of discs) {
      if (!d.discrepancy_type || d.discrepancy_type === 'confirmed') continue;
      let photoId: number | null = null;
      if (isValidPhoto(d.photo)) {
        photoId = addPhoto({ company_id: companyId, entity_type: 'discrepancy', entity_id: handoverId, event: 'discrepancy', photo: d.photo as string, caption: null, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name });
      }
      // Only keep a container link that genuinely belongs to THIS handover.
      const linkedContainer = d.snapshot_container_id != null && snapshotContainerBelongs(d.snapshot_container_id, handoverId, companyId)
        ? d.snapshot_container_id : null;
      const did = createDiscrepancy({
        company_id: companyId, handover_id: handoverId, snapshot_container_id: linkedContainer,
        discrepancy_type: d.discrepancy_type, expected_value: d.expected_value ?? null, reported_value: d.reported_value ?? null,
        note: d.note ?? null, photo_id: photoId, reported_by_user_id: actor.userId, reported_by_name: actor.name,
      });
      logHandoverEvent({
        company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
        entity_type: 'discrepancy', entity_id: did, action: 'discrepancy.reported',
        after: { type: d.discrepancy_type, handover_id: handoverId }, operational_date: h.operational_date,
      });
    }
    logHandoverEvent({
      company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name,
      entity_type: 'handover', entity_id: handoverId, action: 'handover.acknowledged',
      after: { status: newStatus, discrepancies: discs.filter((d) => d.discrepancy_type !== 'confirmed').length }, operational_date: h.operational_date,
    });
    if (idempotencyKey) putIdempotentResult(idempotencyKey, companyId, 'ack', handoverId);
    return { ok: true, handover_id: handoverId, status: newStatus };
  });
  return tx.immediate();
}

// ── Report / resolve a discrepancy after acknowledgement ─────────────────────
export function reportDiscrepancyCmd(
  companyId: number, actor: HandoverActor, handoverId: number, input: DiscrepancyInput,
): CmdResult<{ discrepancy_id: number }> {
  const h = getHandover(handoverId);
  if (!h || h.company_id !== companyId) return { ok: false, status: 404, error: 'Handover not found.' };
  if (h.status === 'draft') return { ok: false, status: 409, error: 'Submit the handover before reporting a discrepancy.' };
  let photoId: number | null = null;
  if (isValidPhoto(input.photo)) {
    photoId = addPhoto({ company_id: companyId, entity_type: 'discrepancy', entity_id: handoverId, event: 'discrepancy', photo: input.photo as string, caption: null, uploaded_by_user_id: actor.userId, uploaded_by_name: actor.name });
  }
  const linkedContainer = input.snapshot_container_id != null && snapshotContainerBelongs(input.snapshot_container_id, handoverId, companyId)
    ? input.snapshot_container_id : null;
  const id = createDiscrepancy({
    company_id: companyId, handover_id: handoverId, snapshot_container_id: linkedContainer,
    discrepancy_type: input.discrepancy_type, expected_value: input.expected_value ?? null, reported_value: input.reported_value ?? null,
    note: input.note ?? null, photo_id: photoId, reported_by_user_id: actor.userId, reported_by_name: actor.name,
  });
  if (h.status === 'acknowledged') updateHandoverRow(handoverId, companyId, { status: 'acknowledged_with_discrepancies' });
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'handover', entity_id: handoverId, action: 'discrepancy.reported', after: { type: input.discrepancy_type }, operational_date: h.operational_date });
  return { ok: true, discrepancy_id: id };
}

export function resolveDiscrepancyCmd(
  companyId: number, actor: HandoverActor, discrepancyId: number, resolutionNote: string | null,
): CmdResult<{ discrepancy_id: number }> {
  const d = getDiscrepancy(discrepancyId);
  if (!d || d.company_id !== companyId) return { ok: false, status: 404, error: 'Discrepancy not found.' };
  resolveDiscrepancy(discrepancyId, companyId, { resolved_by_user_id: actor.userId, resolved_by_name: actor.name, resolution_note: resolutionNote });
  logHandoverEvent({ company_id: companyId, actor_user_id: actor.userId, actor_name: actor.name, entity_type: 'discrepancy', entity_id: discrepancyId, action: 'discrepancy.resolved' });
  return { ok: true, discrepancy_id: discrepancyId };
}
