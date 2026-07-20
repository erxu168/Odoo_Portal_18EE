/**
 * Shift Handover — read models for the mobile screens.
 * Pure reads (no mutation). Composes db.ts + snapshot grouping + the reused
 * count_locations tree.
 */
import { listCountLocations } from '@/lib/inventory-db';
import { buildLocationTree } from '@/lib/location-tree';
import { buildHandoverSections, type HandoverSections } from './snapshot';
import { liveContainersForDate, liveActionsForDate } from './commands';
import {
  listBatches, listContainersByBatch, listContainers,
  listActions, listHandovers, getHandover, getBatch, getContainer,
  listPhotos, countActivePhotos, listSnapshotContainers, listSnapshotActions,
  listDiscrepancies, listHandoverEvents,
  listHandoverProducts, listContainerTypes, getContainerType,
  getHandoverProduct,
} from './db';
import type { HandoverContainer } from './types';

// ── Dashboard overview ───────────────────────────────────────────────────────
export function getOverview(companyId: number, operationalDate: string) {
  const activeContainers = listContainers([companyId], { status: 'active' });
  const todaysBatches = listBatches([companyId], { operational_date: operationalDate });
  const openActions = listActions([companyId], { status: 'open' })
    .concat(listActions([companyId], { status: 'in_progress' }));
  const useFirst = activeContainers.filter((c) => c.use_first);
  const onHold = activeContainers.filter((c) => c.availability_state === 'on_hold' || c.availability_state === 'expired');
  const criticalOpen = openActions.filter((a) => a.priority === 'food_safety_critical');
  const pending = listHandovers([companyId], { status: 'submitted' });
  return {
    batches_today: todaysBatches.length,
    active_containers: activeContainers.length,
    open_actions: openActions.length,
    critical_actions: criticalOpen.length,
    use_first: useFirst.length,
    on_hold: onHold.length,
    pending_handovers: pending.length,
  };
}

// ── Current production (today's batches + containers) ────────────────────────
function containerCard(c: HandoverContainer, typeName: string | null, locName: string | null, productName: string | null = null) {
  const photos = listPhotos('container', c.id);
  return {
    ...c,
    product_name: productName,
    container_type_name: typeName,
    storage_location_name: locName,
    photo_count: photos.length,
    thumb: photos[0]?.photo ?? null,
  };
}

export function getCurrentProduction(companyId: number, operationalDate: string) {
  const batches = listBatches([companyId], { operational_date: operationalDate });
  const locs = new Map(listCountLocations(companyId).map((l) => [l.id, l.name]));
  const types = new Map(listContainerTypes(companyId, { includeInactive: true }).map((t) => [t.id, t.name]));
  return batches.map((batch) => {
    const containers = listContainersByBatch(batch.id).map((c) =>
      containerCard(c, c.container_type_id ? types.get(c.container_type_id) ?? null : null, c.storage_location_id ? locs.get(c.storage_location_id) ?? null : null, batch.product_name));
    const active = containers.filter((c) => c.status === 'active');
    return {
      ...batch,
      containers,
      active_count: active.length,
      outstanding_actions: listActions([companyId], { batch_id: batch.id, status: 'open' }).length,
    };
  });
}

// ── Storage overview (grouped by location) ───────────────────────────────────
export function getStorageOverview(companyId: number, filters?: {
  product_id?: number; storage_location_id?: number; availability_state?: string; preparation_state?: string; use_first?: boolean;
}) {
  const containers = listContainers([companyId], { status: 'active', ...filters });
  const rawLocs = listCountLocations(companyId);
  const locName = new Map(rawLocs.map((l) => [l.id, l.name]));
  const parentOf = new Map(rawLocs.map((l) => [l.id, l.parent_id]));
  const types = new Map(listContainerTypes(companyId, { includeInactive: true }).map((t) => [t.id, t.name]));
  const productNames = new Map(listHandoverProducts(companyId, { includeInactive: true }).map((p) => [p.id, p.name]));

  function path(id: number | null): string {
    if (id == null) return 'No location set';
    const parts: string[] = [];
    let cur: number | null = id;
    const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      parts.unshift(locName.get(cur) ?? `#${cur}`);
      cur = parentOf.get(cur) ?? null;
    }
    return parts.join(' › ');
  }

  const groups = new Map<string, { key: string; label: string; containers: ReturnType<typeof containerCard>[] }>();
  for (const c of containers) {
    const key = c.storage_location_id == null ? 'none' : String(c.storage_location_id);
    if (!groups.has(key)) groups.set(key, { key, label: path(c.storage_location_id), containers: [] });
    groups.get(key)!.containers.push(containerCard(c, c.container_type_id ? types.get(c.container_type_id) ?? null : null, locName.get(c.storage_location_id ?? -1) ?? null, productNames.get(c.product_id) ?? null));
  }
  // "No location set" last, otherwise alphabetical by path.
  return Array.from(groups.values()).sort((a, b) =>
    a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label));
}

// ── Container detail ─────────────────────────────────────────────────────────
export function getContainerDetail(companyId: number, containerId: number) {
  const c = getContainer(containerId);
  if (!c || c.company_id !== companyId) return null;
  const batch = getBatch(c.batch_id);
  const type = c.container_type_id ? getContainerType(c.container_type_id) : null;
  const photos = listPhotos('container', containerId);
  const actions = listActions([companyId], { container_id: containerId });
  return { container: c, batch, container_type: type, photos, actions };
}

// ── Handover live preview ────────────────────────────────────────────────────
export function getHandoverPreview(companyId: number, operationalDate: string): {
  sections: HandoverSections; operational_date: string;
} {
  const containers = liveContainersForDate(companyId, operationalDate);
  const actions = liveActionsForDate(companyId, operationalDate);
  return { sections: buildHandoverSections(containers, actions), operational_date: operationalDate };
}

// ── Handover detail (frozen snapshot) ────────────────────────────────────────
export function getHandoverDetail(companyId: number, handoverId: number) {
  const h = getHandover(handoverId);
  if (!h || h.company_id !== companyId) return null;
  return {
    handover: h,
    snapshot_containers: listSnapshotContainers(handoverId),
    snapshot_actions: listSnapshotActions(handoverId),
    discrepancies: listDiscrepancies(handoverId),
  };
}

export function listHandoverHistory(companyIds: number[] | undefined, filters?: { from?: string; to?: string; status?: string; limit?: number }) {
  return listHandovers(companyIds, filters);
}

// ── Config ───────────────────────────────────────────────────────────────────
export function getConfig(companyId: number) {
  return {
    products: listHandoverProducts(companyId, { includeInactive: true }),
    container_types: listContainerTypes(companyId, { includeInactive: true }),
    locations: buildLocationTree(listCountLocations(companyId) as never),
  };
}

/** Flat location list + tree for pickers. */
export function getLocations(companyId: number) {
  const flat = listCountLocations(companyId);
  return { flat, tree: buildLocationTree(flat as never) };
}

export function getEvents(companyIds: number[] | undefined, filters?: { entity_type?: string; entity_id?: number; operational_date?: string; limit?: number }) {
  return listHandoverEvents(companyIds, filters);
}

/** Products + types + locations + photo policy needed by the record-production wizard. */
export function getRecordFormData(companyId: number) {
  return {
    products: listHandoverProducts(companyId),
    container_types: listContainerTypes(companyId),
    locations: listCountLocations(companyId),
  };
}

export { getHandoverProduct, countActivePhotos };
