/**
 * Inventory Floorplan — viewer manifest builders.
 *
 * Pure assembly over the floorplan tables + count_locations: everything the
 * staff map needs in ONE payload (floors, anchors, places index, type
 * registry) so the client can search locally and work from cache offline.
 * Odoo product data is INJECTED by the route — this file stays synchronous,
 * unit-testable, and never talks to the network.
 */
import { getDb } from '@/lib/db';
import { listCountLocations, listProductImageIds } from '@/lib/inventory-db';
import { locationPath } from '@/lib/location-tree';
import { LOCATION_TYPES } from '@/lib/location-types';
import { initFloorplanTables, listFloors, getRevision, listAnchors, BUILTIN_MARKER_ONLY_KEYS } from './db';
import { MARKER_SHAPES, type MarkerShape, type LocationLayer } from './marker-presets';
import type { Pt } from './types';

// The marker vocabulary lives in a dependency-free module so client
// components can import it without pulling the database into the bundle.
export {
  MARKER_SHAPES, SHAPE_LABELS, MARKER_COLORS, LAYER_LABELS, isMarkerShape,
} from './marker-presets';
export type { MarkerShape, LocationLayer } from './marker-presets';

export interface FloorplanTypeInfo {
  key: string;
  label: string;
  icon: string;
  color: string;
  /** How this type draws on the plan: a circle, or a rounded-rectangle label. */
  shape: MarkerShape;
  /** Hierarchy rank — see LocationLayer. */
  layer: LocationLayer;
  custom: boolean;
  /** Removed from THIS restaurant's library (built-ins can't be deleted). */
  hidden?: boolean;
  /**
   * The marker IS the thing — a shut-off valve, a fuse box. Nothing is stored
   * in it, nothing nests inside it, and it stays out of the product location
   * picker. Ethan's rule, 2026-07-31.
   */
  markerOnly?: boolean;
  /** location_kinds row id — custom types only (rename/recolor/delete). */
  id?: number;
}

export interface ManifestAnchor {
  id: number;
  locationId: number;
  polygon: Pt[];
  /** THE SPOT — what the marker marks. A leader line never moves this. */
  cx: number;
  cy: number;
  /** Where the ICON is drawn; null = on the spot, i.e. no leader line. */
  pinCx: number | null;
  pinCy: number | null;
  display: 'overlay' | 'pin';
  label: string;
  typeKey: string;
  room: string | null;
  path: string;
}

export interface ManifestFloor {
  id: number;
  name: string;
  code: string;
  sortOrder: number;
  revision: { id: number; revisionNo: number; rasterUrl: string; width: number; height: number } | null;
}

export interface InjectedProduct { id: number; name: string; category: string | null }

export interface FloorplanManifest {
  companyId: number;
  floors: ManifestFloor[];
  anchors: Record<number, ManifestAnchor[]>;
  places: Array<{ locationId: number; label: string; typeKey: string; room: string | null; floorId: number; bucket: 'room' | 'utility' | 'spot' }>;
  products: Array<{ id: number; name: string; category: string | null; hasImage: boolean; locationIds: number[] }>;
  productsUnavailable: boolean;
  types: FloorplanTypeInfo[];
}

/** Floorplan palette per built-in type key; customs fall back to slate. */
const BUILTIN_COLORS: Record<string, string> = {
  floor: '#64748B', area: '#F59E0B', room: '#F59E0B',
  walkin: '#06B6D4', fridge: '#06B6D4', counterfridge: '#06B6D4',
  freezer: '#6366F1', counterfreezer: '#6366F1',
  dryshelf: '#3B82F6', shelf: '#16A34A', drawer: '#8B5CF6', bin: '#8B5CF6',
  floorspace: '#3B82F6', cabinet: '#8B5CF6', utility: '#64748B',
};
const CUSTOM_FALLBACK = '#64748B';

/** Built-ins that describe an AREA or a fixed installation read as labels. */
const LABEL_SHAPED = new Set(['floor', 'area', 'room', 'utility']);
/** Built-ins that mark a thing rather than hold products. */
const BUILTIN_MARKER_ONLY = new Set(BUILTIN_MARKER_ONLY_KEYS);

/** Built-in hierarchy ranks (see LocationLayer). */
const BUILTIN_LAYER: Record<string, LocationLayer> = {
  floor: 1, area: 1,
  room: 2, walkin: 2,
  fridge: 3, freezer: 3, counterfridge: 3, counterfreezer: 3,
  dryshelf: 3, shelf: 3, floorspace: 3, cabinet: 3, utility: 3,
  drawer: 4, bin: 4,
};

/** Built-in types + the company's custom location_kinds, one flat registry. */
export function getTypeRegistry(companyId: number): FloorplanTypeInfo[] {
  initFloorplanTables();
  const builtIns: FloorplanTypeInfo[] = LOCATION_TYPES.map(t => ({
    key: t.key, label: t.label, icon: t.icon,
    color: BUILTIN_COLORS[t.key] ?? CUSTOM_FALLBACK,
    shape: LABEL_SHAPED.has(t.key) ? 'label' : 'dot',
    layer: BUILTIN_LAYER[t.key] ?? 3,
    markerOnly: BUILTIN_MARKER_ONLY.has(t.key),
    custom: false,
  }));
  const rows = getDb().prepare(
    'SELECT id, kind, label, icon, color, shape, layer, hidden, marker_only FROM location_kinds WHERE company_id = ? ORDER BY sort_order, id',
  ).all(companyId) as Array<{ id: number; kind: string; label: string; icon: string | null; color: string | null; shape: string | null; layer: number | null; hidden: number | null; marker_only: number | null }>;

  const byKey = new Map(builtIns.map(b => [b.key, { ...b }]));
  const customs: FloorplanTypeInfo[] = [];
  const shapeOf = (v: string | null, fallback: MarkerShape): MarkerShape =>
    (MARKER_SHAPES as readonly string[]).includes(v ?? '') ? (v as MarkerShape) : fallback;
  const layerOf = (v: number | null, fallback: LocationLayer): LocationLayer =>
    ([1, 2, 3, 4].includes(Number(v)) ? Number(v) : fallback) as LocationLayer;

  for (const k of rows) {
    const base = byKey.get(k.kind);
    if (base) {
      // A company row for a BUILT-IN key is an override: relabel, recolor,
      // reshape — or hide it from this restaurant's library.
      byKey.set(k.kind, {
        ...base,
        id: k.id,
        label: k.label || base.label,
        icon: k.icon || base.icon,
        color: k.color || base.color,
        shape: shapeOf(k.shape, base.shape),
        layer: layerOf(k.layer, base.layer),
        hidden: k.hidden === 1,
        // NULL = this restaurant never said; keep the built-in's own answer.
        markerOnly: k.marker_only == null ? base.markerOnly : k.marker_only === 1,
      });
    } else {
      customs.push({
        key: k.kind, label: k.label, icon: k.icon || '📍',
        color: k.color || CUSTOM_FALLBACK,
        shape: shapeOf(k.shape, 'dot'),
        layer: layerOf(k.layer, 3),
        custom: true, id: k.id, hidden: k.hidden === 1,
        markerOnly: k.marker_only === 1,
      });
    }
  }
  return [...Array.from(byKey.values()), ...customs];
}

export function buildManifest(
  companyId: number,
  injected: { products: InjectedProduct[] | null },
): FloorplanManifest {
  initFloorplanTables();
  const db = getDb();

  const locations = listCountLocations(companyId) as Array<{ id: number; name: string; parent_id: number | null; kind: string; sort_order: number }>;
  const locById = new Map(locations.map(l => [l.id, l]));
  const pathOf = (id: number) => locationPath(id, locations).join(' · ');
  const roomOf = (id: number): string | null => {
    const parts = locationPath(id, locations);
    return parts.length > 1 ? parts[parts.length - 2] : null;
  };

  const floors: ManifestFloor[] = [];
  const anchors: Record<number, ManifestAnchor[]> = {};
  const places: FloorplanManifest['places'] = [];

  for (const f of listFloors([companyId])) {
    const rev = f.current_revision_id ? getRevision(f.current_revision_id) : null;
    const published = rev && rev.status === 'published' ? rev : null;
    floors.push({
      id: f.id, name: f.name, code: f.code, sortOrder: f.sort_order,
      revision: published
        ? {
            id: published.id, revisionNo: published.revision_no,
            rasterUrl: `/api/inventory/floorplans/assets/${published.id}/raster`,
            width: published.raster_width, height: published.raster_height,
          }
        : null,
    });
    if (!published) continue;

    anchors[f.id] = listAnchors(published.id)
      .filter(a => locById.has(a.count_location_id)) // archived spots stay out of staff surfaces
      .map(a => {
        const loc = locById.get(a.count_location_id)!;
        return {
          id: a.id, locationId: a.count_location_id, polygon: a.polygon,
          cx: a.cx, cy: a.cy, display: a.display, label: a.label,
          // Only a COMPLETE pair counts as pulled out — half a coordinate is
          // not a position, and drawing an arrow to a guess would be worse
          // than drawing none.
          pinCx: a.pin_cx != null && a.pin_cy != null ? a.pin_cx : null,
          pinCy: a.pin_cx != null && a.pin_cy != null ? a.pin_cy : null,
          typeKey: loc.kind, room: roomOf(loc.id), path: pathOf(loc.id),
        };
      });

    for (const a of anchors[f.id]) {
      const bucket = a.typeKey === 'room' ? 'room' : a.typeKey === 'utility' ? 'utility' : 'spot';
      places.push({ locationId: a.locationId, label: a.label, typeKey: a.typeKey, room: a.room, floorId: f.id, bucket });
    }
  }

  // products: placements for THIS company's locations, joined with injected Odoo data
  const locIds = locations.map(l => l.id);
  const byProduct = new Map<number, number[]>();
  if (locIds.length > 0) {
    const ph = locIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT odoo_product_id, count_location_id FROM product_locations WHERE count_location_id IN (${ph})`,
    ).all(...locIds) as Array<{ odoo_product_id: number; count_location_id: number }>;
    for (const r of rows) {
      if (!byProduct.has(r.odoo_product_id)) byProduct.set(r.odoo_product_id, []);
      byProduct.get(r.odoo_product_id)!.push(r.count_location_id);
    }
  }
  const withImages = new Set(listProductImageIds());
  const products: FloorplanManifest['products'] = [];
  if (injected.products) {
    const nameById = new Map(injected.products.map(p => [p.id, p]));
    for (const [productId, ids] of Array.from(byProduct.entries())) {
      const p = nameById.get(productId);
      if (!p) continue; // product no longer in Odoo → nothing to search for
      products.push({ id: productId, name: p.name, category: p.category, hasImage: withImages.has(productId), locationIds: ids });
    }
    products.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    companyId,
    floors,
    anchors,
    places,
    products,
    productsUnavailable: injected.products === null,
    types: getTypeRegistry(companyId),
  };
}

/** The distinct product ids placed at this company's spots (for the Odoo fetch). */
export function placedProductIds(companyId: number): number[] {
  initFloorplanTables();
  const locations = listCountLocations(companyId) as Array<{ id: number }>;
  if (locations.length === 0) return [];
  const ph = locations.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT DISTINCT odoo_product_id FROM product_locations WHERE count_location_id IN (${ph})`,
  ).all(...locations.map(l => l.id)) as Array<{ odoo_product_id: number }>;
  return rows.map(r => r.odoo_product_id);
}
