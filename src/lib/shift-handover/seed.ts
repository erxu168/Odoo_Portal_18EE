/**
 * Shift Handover — default data for a fresh company.
 *
 * Idempotent: safe to call repeatedly. Products and container types live in
 * handover-only tables. Storage locations REUSE the portal's shared
 * count_locations tree (name-guarded so we never duplicate an existing shelf).
 */
import {
  listCountLocations,
  createCountLocation,
  addLocationKind,
  listLocationKinds,
} from '@/lib/inventory-db';
import {
  listHandoverProducts,
  createHandoverProduct,
  listContainerTypes,
  createContainerType,
} from './db';

/** Opening / Mid / Closing — used as the outgoing/incoming shift boundary label. */
export const DEFAULT_SHIFT_LABELS = ['Opening', 'Mid', 'Closing'] as const;

const DEFAULT_PRODUCTS: Array<{ name: string; kind: string; photo_policy: string }> = [
  { name: 'Smoked Jerk Chicken', kind: 'finished', photo_policy: 'mandatory' },
  { name: 'Cut Coleslaw Vegetables', kind: 'component', photo_policy: 'recommended' },
  { name: 'Coleslaw Dressing', kind: 'component', photo_policy: 'recommended' },
  { name: 'Finished Coleslaw', kind: 'finished', photo_policy: 'mandatory' },
];

const DEFAULT_CONTAINER_TYPES: Array<{ name: string; category: string; capacity_label?: string }> = [
  { name: 'GN 1/1', category: 'gastronorm', capacity_label: 'Full pan' },
  { name: 'GN 1/2', category: 'gastronorm', capacity_label: 'Half pan' },
  { name: 'GN 1/3', category: 'gastronorm', capacity_label: 'Third pan' },
  { name: '5-litre tub', category: 'plastic', capacity_label: '5 L' },
  { name: '10-litre tub', category: 'plastic', capacity_label: '10 L' },
  { name: 'Tray', category: 'tray' },
  { name: 'Bucket', category: 'bucket' },
  { name: 'Sauce bottle', category: 'bottle' },
  { name: 'Vacuum bag', category: 'bag' },
  { name: 'Portion container', category: 'portion' },
];

/** parent name → child names, plus a kind hint. */
const DEFAULT_LOCATIONS: Array<{ name: string; kind: string; children?: string[] }> = [
  { name: 'Countertop Fridge', kind: 'fridge', children: ['Left Drawer', 'Right Drawer'] },
  { name: 'Cooling Chamber', kind: 'fridge', children: ['Rack 1', 'Rack 2'] },
  { name: 'Walk-in Fridge', kind: 'fridge' },
  { name: 'Freezer', kind: 'freezer' },
  { name: 'Hot Holding', kind: 'hot holding' },
  { name: 'Prep Area', kind: 'area' },
];

export function seedHandoverDefaults(companyId: number, userId: number): void {
  // Products (only when the company has none yet).
  if (listHandoverProducts(companyId, { includeInactive: true }).length === 0) {
    DEFAULT_PRODUCTS.forEach((p, i) =>
      createHandoverProduct({ company_id: companyId, name: p.name, kind: p.kind, photo_policy: p.photo_policy, sort_order: i * 10 }));
  }

  // Container types (only when the company has none yet).
  if (listContainerTypes(companyId, { includeInactive: true }).length === 0) {
    DEFAULT_CONTAINER_TYPES.forEach((t, i) =>
      createContainerType({ company_id: companyId, name: t.name, category: t.category, capacity_label: t.capacity_label ?? null, sort_order: i * 10 }));
  }

  // Storage locations — reuse count_locations, name-guarded so we never
  // duplicate a shelf the inventory module already created.
  seedStorageLocations(companyId, userId);
}

function seedStorageLocations(companyId: number, userId: number): void {
  // Ensure a Hot Holding kind exists (free-text kinds, but keep it tidy).
  try {
    const kinds = listLocationKinds(companyId).map((k) => k.kind);
    if (!kinds.includes('hot holding')) addLocationKind(companyId, 'Hot Holding', userId);
  } catch { /* kind seeding is best-effort */ }

  const existing = listCountLocations(companyId);
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));

  for (const loc of DEFAULT_LOCATIONS) {
    let parentId = byName.get(loc.name.toLowerCase())?.id;
    if (parentId == null) {
      parentId = createCountLocation({ company_id: companyId, name: loc.name, kind: loc.kind, created_by: userId });
      byName.set(loc.name.toLowerCase(), { id: parentId } as never);
    }
    for (const child of loc.children ?? []) {
      const childKey = `${loc.name.toLowerCase()}>${child.toLowerCase()}`;
      // A child shares its name with siblings elsewhere (e.g. "Rack 1"), so guard
      // on parent+name, not name alone.
      const alreadyChild = existing.some(
        (l) => l.parent_id === parentId && l.name.toLowerCase() === child.toLowerCase(),
      );
      if (!alreadyChild && !byName.has(childKey)) {
        createCountLocation({ company_id: companyId, parent_id: parentId, name: child, kind: loc.kind, created_by: userId });
        byName.set(childKey, { id: -1 } as never);
      }
    }
  }
}
