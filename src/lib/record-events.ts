'use client';

/**
 * "This record changed" — a signal any screen can send and any list can hear.
 *
 * THE PROBLEM. Delete a location from its own page and the Locations list still
 * shows it. Only a browser refresh clears it. Ethan, 2026-07-30: *"only when i
 * refresh the page, the location is gone. i think this is a common issue
 * throughout the portal."* He is right — the same defect was fixed twice in the
 * Products module the day before, each time by hand.
 *
 * WHY IT HAPPENS. The detail page finishes with `router.replace('/inventory')`.
 * Next's App Router serves the CACHED route, and that page holds its list in
 * React state — so you get back the screen exactly as you left it, deleted row
 * included. Worse, the re-mount also throws away your scroll position, which is
 * the second complaint: *"i dont want to start from the top page whenever i
 * follow a link to another form, when i come back i want to start where i left
 * off with."*
 *
 * Both symptoms are one cause, and both are fixed by not needing the navigation
 * to carry the news. The mutating screen announces what it did; every mounted
 * list that cares updates in place. Nothing re-mounts, so nothing scrolls.
 *
 * WHY A PLAIN MODULE-LEVEL EMITTER rather than context or a store library:
 *  - it works across the router cache, which is the whole point — a page kept
 *    alive by Next still receives it
 *  - a publisher does not need to be inside any provider, so an API-calling
 *    handler deep in a sheet can announce without plumbing
 *  - it dies with the page, so nothing is ever stale on a fresh load
 *
 * Deliberately NOT a cache. It carries no data, only "record X of kind Y was
 * deleted / changed". Each list already knows how to render its own rows; being
 * told is all it was missing.
 */

/** The kinds of record a screen can announce. Add as needed. */
export type RecordKind =
  | 'location'
  | 'product'
  | 'list'          // counting template
  | 'supplier'
  | 'employee'
  | 'session'       // a count
  | 'guide-item'
  | 'draft';        // a scanned product awaiting setup

export type ChangeVerb = 'deleted' | 'created' | 'updated' | 'archived' | 'restored';

export interface RecordChange {
  kind: RecordKind;
  verb: ChangeVerb;
  /** The record itself. */
  id: number;
  /**
   * Ids that ALSO went, for a cascade — deleting a room removes its shelves.
   * A list that only drops `id` would keep showing children of a gone parent.
   */
  alsoAffected?: number[];
  /** Anything the listener needs beyond the id, e.g. the new name after a rename. */
  patch?: Record<string, unknown>;
}

type Listener = (change: RecordChange) => void;

/** kind → listeners. Module-level on purpose; see the note above. */
const listeners = new Map<RecordKind, Set<Listener>>();

/**
 * Announce a change. Call this straight after the server confirms it — never
 * before, or a failed delete removes the row anyway.
 *
 * A listener that throws must not stop the others from hearing it, so each is
 * called in isolation.
 */
export function announceChange(change: RecordChange): void {
  const set = listeners.get(change.kind);
  if (!set) return;
  // Snapshot: a listener that unsubscribes while handling would otherwise mutate
  // the set mid-iteration.
  for (const fn of Array.from(set)) {
    try { fn(change); } catch (e) { console.error('[record-events] listener failed', change.kind, e); }
  }
}

/** Subscribe. Returns the unsubscribe. Prefer the hook below in components. */
export function onRecordChange(kind: RecordKind, fn: Listener): () => void {
  let set = listeners.get(kind);
  if (!set) { set = new Set(); listeners.set(kind, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(kind);
  };
}

/** Every id a change removed — the record plus anything that cascaded with it. */
export function removedIds(change: RecordChange): number[] {
  return change.verb === 'deleted' || change.verb === 'archived'
    ? [change.id, ...(change.alsoAffected || [])]
    : [];
}
