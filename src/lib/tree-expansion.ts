'use client';

/**
 * Which branches of a tree are open.
 *
 * Ethan, 2026-07-30: *"the screen should only be remember for the current moment.
 * whenver i reload the browser then it should start from the top."*
 *
 * That rules out both browser storages, and the reason is worth writing down
 * because the names mislead:
 *
 *   localStorage    survives a reload AND a restart  — far too sticky
 *   sessionStorage  survives a RELOAD too; it only clears when the TAB closes
 *   React state     dies when the component unmounts — so walking to a detail
 *                   page and back would lose the expansion, which is the other
 *                   thing he asked never to happen
 *
 * So: a plain module-level Map. It outlives client-side navigation, because the
 * module stays loaded while the SPA does — you leave a room, edit a shelf, come
 * back, and the tree is as you left it. And it dies with the page, so a reload
 * genuinely starts collapsed. Nothing to expire, nothing to clean up, and less
 * code than persisting would have been.
 *
 * Keyed per screen: how you leave the Locations manager should not decide how a
 * picker sheet opens.
 */

const open = new Map<string, Set<number>>();

/**
 * Listeners per scope, so a node can re-render itself when the store changes.
 *
 * Needed because the store deliberately lives OUTSIDE React (see above): without
 * this, "Expand all" would change the data and nothing would repaint, and every
 * caller would have to thread a version counter down through its whole tree —
 * which is exactly the plumbing a shared component exists to remove.
 */
const watchers = new Map<string, Set<() => void>>();

function notify(scope: string): void {
  const set = watchers.get(scope);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(); } catch { /* one bad listener must not stop the repaint */ }
  }
}

/** Subscribe to expansion changes in one scope. Returns the unsubscribe. */
export function onExpansionChange(scope: string, fn: () => void): () => void {
  let set = watchers.get(scope);
  if (!set) { set = new Set(); watchers.set(scope, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) watchers.delete(scope);
  };
}

function setFor(scope: string): Set<number> {
  let s = open.get(scope);
  if (!s) { s = new Set(); open.set(scope, s); }
  return s;
}

export function isExpanded(scope: string, id: number): boolean {
  return setFor(scope).has(id);
}

export function toggleExpanded(scope: string, id: number): boolean {
  const s = setFor(scope);
  const next = !s.has(id);
  if (next) s.add(id); else s.delete(id);
  notify(scope);
  return next;
}

export function setExpanded(scope: string, id: number, next: boolean): void {
  const s = setFor(scope);
  const had = s.has(id);
  if (next) s.add(id); else s.delete(id);
  if (had !== next) notify(scope);
}

/** Open every branch — the "building the map" mode. */
export function expandAll(scope: string, ids: number[]): void {
  const s = setFor(scope);
  ids.forEach((id) => s.add(id));
  notify(scope);
}

/** Back to the overview. */
export function collapseAll(scope: string): void {
  open.set(scope, new Set());
  notify(scope);
}

export function expandedCount(scope: string): number {
  return setFor(scope).size;
}

/**
 * Open every ancestor of `id` so a selected or searched-for row is never hidden
 * behind a closed parent. `parentOf` walks upward; the loop is bounded so a
 * corrupt cycle cannot hang the screen.
 */
export function revealPath(scope: string, id: number, parentOf: (id: number) => number | null | undefined): void {
  const s = setFor(scope);
  let cur = parentOf(id);
  let hops = 0;
  let changed = false;
  while (cur != null && hops++ < 64) {
    if (!s.has(cur)) { s.add(cur); changed = true; }
    cur = parentOf(cur);
  }
  if (changed) notify(scope);
}
