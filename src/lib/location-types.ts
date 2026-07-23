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
  { key: 'area',     label: 'Area',           icon: '🏢', suggests: ['room', 'fridge', 'freezer', 'walkin', 'dryshelf', 'shelf'] },
  { key: 'room',     label: 'Room',           icon: '🚪', temp: 'ambient', suggests: ['fridge', 'freezer', 'walkin', 'dryshelf', 'shelf'] },
  { key: 'walkin',   label: 'Walk-in cooler', icon: '❄️', temp: 'cold',   suggests: ['shelf', 'bin'] },
  { key: 'fridge',   label: 'Fridge',         icon: '🧊', temp: 'cold',   suggests: ['shelf', 'bin'] },
  { key: 'freezer',  label: 'Freezer',        icon: '🥶', temp: 'frozen', suggests: ['shelf', 'bin'] },
  { key: 'dryshelf', label: 'Dry shelving',   icon: '📦', temp: 'dry',    suggests: ['shelf', 'bin'] },
  { key: 'shelf',    label: 'Shelf',          icon: '🗄️', suggests: ['shelf', 'bin'] },
  { key: 'bin',      label: 'Bin / crate',    icon: '🧺', suggests: ['bin'] },
];

/** Types offered at the TOP level ("+ Add …" with no parent). */
export const TOP_LEVEL_TYPE_KEYS = ['area', 'room', 'fridge', 'freezer', 'walkin', 'dryshelf'];

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
