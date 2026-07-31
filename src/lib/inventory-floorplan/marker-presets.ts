/**
 * Inventory Floorplan — the marker vocabulary, shared by the BROWSER and the
 * server. Deliberately dependency-free: manifest.ts pulls in the database, so
 * a client component importing shapes/colours from there would drag
 * better-sqlite3 into the bundle (it did, and the build broke).
 */

/**
 * Marker shapes the library offers. 'label' is the text pill (rooms, zones);
 * every other value draws the icon inside that outline — so a manager can give
 * e.g. all utilities a star without touching code.
 */
export const MARKER_SHAPES = ['dot', 'label', 'square', 'diamond', 'star', 'hex', 'triangle', 'shield'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

/** Plain-language names for the shape picker. */
export const SHAPE_LABELS: Record<MarkerShape, string> = {
  dot: 'Circle', label: 'Label', square: 'Square', diamond: 'Diamond',
  star: 'Star', hex: 'Hexagon', triangle: 'Triangle', shield: 'Shield',
};

/** The palette the builder offers (no free-form colour picking). */
export const MARKER_COLORS: Array<{ hex: string; name: string }> = [
  { hex: '#16A34A', name: 'Green' },
  { hex: '#3B82F6', name: 'Blue' },
  { hex: '#06B6D4', name: 'Cyan' },
  { hex: '#6366F1', name: 'Indigo' },
  { hex: '#8B5CF6', name: 'Purple' },
  { hex: '#F59E0B', name: 'Amber' },
  { hex: '#EF4444', name: 'Red' },
  { hex: '#EC4899', name: 'Pink' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#64748B', name: 'Slate' },
  { hex: '#78350F', name: 'Brown' },
  { hex: '#111827', name: 'Black' },
];

/**
 * WHERE a type sits in the hierarchy — the sequence staff are guided along:
 *   1 Area   (a floor, a whole zone)
 *   2 Room   (a room, a walk-in)
 *   3 Item   (fridge, freezer, shelf unit, cabinet, floor space, utility)
 *   4 Inside (level, drawer, bin — a subdivision of an item)
 * Used to SUGGEST the right parent when placing and to order what staff see.
 * Never a hard rule: real kitchens break tidy models, so it guides, not blocks.
 */
export type LocationLayer = 1 | 2 | 3 | 4;

export const LAYER_LABELS: Record<LocationLayer, string> = {
  1: 'Area', 2: 'Room', 3: 'Item', 4: 'Inside an item',
};

export const isMarkerShape = (v: unknown): v is MarkerShape =>
  (MARKER_SHAPES as readonly string[]).includes(String(v));

/**
 * The type chips are a FILTER: with one or more types picked, the plan shows
 * those types and NOTHING else; with none picked ("All") it shows everything.
 * Several picks are OR-ed, so chips toggle independently.
 *
 * Kept here, generic over `typeKey`, so both the map and its tests can use it
 * without pulling a component — or the database — along with it.
 */
export function filterByType<T extends { typeKey: string }>(items: T[], keys: string[]): T[] {
  if (!keys.length) return items;
  const want = new Set(keys);
  return items.filter(i => want.has(i.typeKey));
}
