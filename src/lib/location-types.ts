/**
 * The fixed set of location TYPES (stored in count_locations.kind — the column
 * from the old type system, repurposed). Types are BUILT-IN and not user-editable:
 * vocabulary flexibility comes from the free node NAME, not from editing types
 * (which is what caused the old "can't delete a type in use" pain).
 *
 * A type drives three things: the icon shown in the tree / spot picker / printed
 * label, the SMART "+ Add <type>" buttons offered when adding inside a node (its
 * `suggests` list), and a temperature hint ("where does this product belong").
 * Types do NOT hard-enforce containment — an "Add something else…" escape always
 * offers the full list — so the structure guides without ever blocking (Areas are
 * countable, shelves/bins nest to any depth).
 */
export interface LocationType {
  key: string;                 // stored value on count_locations.kind (lowercase)
  label: string;               // human label, e.g. "Walk-in cooler"
  icon: string;                // emoji shown in the tree / labels
  temp?: 'cold' | 'frozen' | 'dry' | 'ambient';
  /** The quick "+ Add <type>" buttons offered when adding a child INSIDE this type. */
  suggests: string[];
}

export const LOCATION_TYPES: LocationType[] = [
  { key: 'floor',    label: 'Floor',          icon: '🏢', suggests: ['room'] },
  { key: 'area',     label: 'Area',           icon: '🗺️', suggests: ['room', 'fridge', 'freezer', 'counterfridge', 'counterfreezer', 'walkin', 'dryshelf', 'shelf'] },
  { key: 'room',     label: 'Room',           icon: '🚪', temp: 'ambient', suggests: ['fridge', 'freezer', 'counterfridge', 'counterfreezer', 'walkin', 'dryshelf', 'shelf', 'floorspace', 'cabinet'] },
  { key: 'walkin',   label: 'Walk-in cooler', icon: '❄️', temp: 'cold',   suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'fridge',   label: 'Fridge',         icon: '🧊', temp: 'cold',   suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'freezer',  label: 'Freezer',        icon: '🥶', temp: 'frozen', suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'counterfridge',  label: 'Countertop fridge',  icon: '🧊', temp: 'cold',   suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'counterfreezer', label: 'Countertop freezer', icon: '🥶', temp: 'frozen', suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'dryshelf', label: 'Dry shelving',   icon: '📦', temp: 'dry',    suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'shelf',    label: 'Shelf',          icon: '🗄️', suggests: ['drawer', 'shelf', 'bin'] },
  { key: 'floorspace', label: 'Floor space',  icon: '📦', suggests: ['bin'] },
  { key: 'cabinet',  label: 'Cabinet',        icon: '🧰', suggests: ['shelf', 'drawer', 'bin'] },
  { key: 'utility',  label: 'Utility',        icon: '🔧', suggests: [] },
  { key: 'drawer',   label: 'Drawer',         icon: '🗃️', suggests: ['bin'] },
  { key: 'bin',      label: 'Bin / crate',    icon: '🧺', suggests: ['bin'] },
];

/** Types offered at the TOP level ("+ Add …" with no parent). */
export const TOP_LEVEL_TYPE_KEYS = ['floor', 'area', 'room', 'fridge', 'freezer', 'counterfridge', 'counterfreezer', 'walkin', 'dryshelf', 'utility'];

const FALLBACK: LocationType = { key: 'area', label: 'Location', icon: '📍', suggests: [] };

export function locationType(key: string | null | undefined): LocationType {
  return LOCATION_TYPES.find((t) => t.key === (key || '').toLowerCase()) || FALLBACK;
}
export const typeIcon = (key: string | null | undefined): string => locationType(key).icon;
export const typeLabel = (key: string | null | undefined): string => locationType(key).label;

/** The quick-add child types for a node of the given type (falls back to a sensible set). */
export function suggestedChildTypes(parentKey: string | null | undefined): LocationType[] {
  const keys = locationType(parentKey).suggests;
  const list = keys.map((k) => LOCATION_TYPES.find((t) => t.key === k)).filter(Boolean) as LocationType[];
  return list.length ? list : LOCATION_TYPES.filter((t) => ['shelf', 'bin'].includes(t.key));
}
