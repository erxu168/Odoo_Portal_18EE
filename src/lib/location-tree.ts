/** Pure helpers for the count-location hierarchy. No I/O — safe to unit test. */

export interface TreeRow {
  id: number;
  parent_id: number | null;
  sort_order: number;
}

export type LocationNode<T extends TreeRow = TreeRow> = T & { children: LocationNode<T>[] };

/**
 * Nest children under parents (2 levels in practice, but works to any depth),
 * each level sorted by sort_order then id.
 */
export function buildLocationTree<T extends TreeRow>(rows: T[]): LocationNode<T>[] {
  const byId = new Map<number, LocationNode<T>>();
  rows.forEach((r) => byId.set(r.id, { ...(r as T), children: [] }));
  const roots: LocationNode<T>[] = [];
  byId.forEach((node) => {
    const pid = node.parent_id;
    if (pid != null && byId.has(pid)) byId.get(pid)!.children.push(node);
    else roots.push(node);
  });
  const sort = (a: LocationNode<T>, b: LocationNode<T>) => a.sort_order - b.sort_order || a.id - b.id;
  const walk = (list: LocationNode<T>[]) => { list.sort(sort); list.forEach((n) => walk(n.children)); };
  walk(roots);
  return roots;
}

/**
 * Full path of a location, root → leaf, as an array of names — e.g.
 * ["Basement", "Freezer"] or ["Ground floor", "Kitchen", "Walk-in 1", "Shelf 3"].
 * Walks parent_id up; a cycle guard keeps it safe on malformed data.
 */
export function locationPath<T extends TreeRow & { name: string }>(id: number, rows: T[]): string[] {
  const byId = new Map<number, T>(rows.map((r) => [r.id, r]));
  const path: string[] = [];
  const seen = new Set<number>();
  let cur: T | undefined = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur.name);
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}

/** The full path joined for display, e.g. "Ground floor › Kitchen › Freezer". */
export function locationPathLabel<T extends TreeRow & { name: string }>(id: number, rows: T[], sep = ' › '): string {
  return locationPath(id, rows).join(sep);
}

/**
 * Next walking-order value for a sibling set: max + 10, or 10 when empty.
 * Gaps of 10 leave room to insert between two spots later.
 */
export function nextSortOrder(siblings: { sort_order: number }[]): number {
  if (siblings.length === 0) return 10;
  return Math.max(...siblings.map((s) => s.sort_order)) + 10;
}

/**
 * Move an id one slot in the given direction within an ordered id list.
 * Edge moves are a no-op. Returns a new array.
 */
export function reorder(ordered: number[], id: number, dir: -1 | 1): number[] {
  const i = ordered.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return ordered.slice();
  const next = ordered.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
