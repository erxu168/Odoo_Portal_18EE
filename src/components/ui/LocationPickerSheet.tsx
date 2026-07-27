'use client';

/**
 * Pick a real place from the restaurant's location tree.
 *
 * Anywhere a person says WHERE something is, they pick it here rather than
 * typing it — four shifts typing "walkin", "Walk-in", "WIC top" and "cooler 1"
 * describe one fridge and the system cannot tell. You walk down one level at a
 * time, and you can stop at any level ("it's in the walk-in", without naming a
 * shelf), because that is how people actually talk about a kitchen.
 *
 * The list is the same one the stock count uses. There is deliberately no
 * second, module-specific set of places to keep in step.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { locationPathLabel } from '@/lib/location-tree';
import { typeIcon } from '@/lib/location-types';

export interface PickableLocation {
  id: number;
  parent_id: number | null;
  name: string;
  kind: string;
  sort_order: number;
}

/** Anything arranged as a tree can be picked here — places, categories. */
export interface TreeNode {
  id: number;
  parent_id: number | null;
  name: string;
  sort_order?: number;
}

export function LocationPickerSheet(props: {
  locations: PickableLocation[];
  value: number | null;
  onPick: (id: number, label: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const { locations, ...rest } = props;
  return <TreePickerSheet nodes={locations} iconOf={(n) => typeIcon((n as PickableLocation).kind)} {...rest} />;
}

/**
 * The picker itself. `hereLabel` is what the "stop at this level" row says —
 * a place is where a thing IS, a category is what a thing IS, and the sentence
 * has to match or it reads as nonsense.
 */
export function TreePickerSheet({
  nodes, value, onPick, onClose, title = 'Choose',
  iconOf, hereLabel = (n: TreeNode) => `It’s right here — ${n.name}`,
  searchLabel = 'Search all places',
  emptyLabel = 'No places have been set up yet. A manager adds them under Stock → Locations.',
}: {
  nodes: TreeNode[];
  value: number | null;
  onPick: (id: number, label: string) => void;
  onClose: () => void;
  title?: string;
  iconOf?: (n: TreeNode) => string;
  hereLabel?: (n: TreeNode) => string;
  searchLabel?: string;
  emptyLabel?: string;
}) {
  // sort_order is optional on a generic node; the shared path helpers want it.
  const locations = useMemo(
    () => nodes.map((n) => ({ ...n, sort_order: n.sort_order ?? 0 })),
    [nodes],
  );
  const [parent, setParent] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  /**
   * The parent we will actually navigate by. A row whose parent has been
   * deleted, or which sits in a loop, is treated as a top-level place instead
   * of vanishing from the list entirely — a place you cannot see is a place
   * you cannot say your soup is in.
   */
  const effParent = useMemo(() => {
    // Each node is resolved once and the answer is remembered for everything
    // below it, so this stays linear however deep the tree runs.
    const loops = new Map<number, boolean>();
    for (const start of locations) {
      if (loops.has(start.id)) continue;
      const walked: number[] = [];
      const onPath = new Set<number>();
      let cur: number | null = start.id;
      let looped = false;
      for (;;) {
        if (cur == null) break;
        const known = loops.get(cur);
        if (known !== undefined) { looped = known; break; }
        if (onPath.has(cur)) { looped = true; break; }
        onPath.add(cur);
        walked.push(cur);
        const p: number | null = byId.get(cur)?.parent_id ?? null;
        cur = p != null && byId.has(p) ? p : null;
      }
      for (const id of walked) loops.set(id, looped);
    }
    const m = new Map<number, number | null>();
    for (const l of locations) {
      const p = l.parent_id ?? null;
      m.set(l.id, loops.get(l.id) || p == null || !byId.has(p) ? null : p);
    }
    return m;
  }, [locations, byId]);

  const childrenOf = useMemo(() => {
    const m = new Map<number | null, (TreeNode & { sort_order: number })[]>();
    locations.forEach((l) => {
      const k = effParent.get(l.id) ?? null;
      const arr = m.get(k) || [];
      arr.push(l);
      m.set(k, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    return m;
  }, [locations, effParent]);

  // One pass, deepest first, with an explicit stack — no recursion to overflow
  // and no re-walking the same ancestors for every leaf.
  const countUnder = useMemo(() => {
    const n = new Map<number, number>();
    for (const root of childrenOf.get(null) || []) {
      const stack: { id: number; done: boolean }[] = [{ id: root.id, done: false }];
      while (stack.length) {
        const cur = stack.pop()!;
        const kids = childrenOf.get(cur.id) || [];
        if (cur.done) {
          n.set(cur.id, kids.reduce((a, k) => a + 1 + (n.get(k.id) || 0), 0));
        } else {
          stack.push({ id: cur.id, done: true });
          for (const k of kids) stack.push({ id: k.id, done: false });
        }
      }
    }
    return n;
  }, [childrenOf]);

  const trail = useMemo(() => {
    const out: (TreeNode & { sort_order: number })[] = [];
    const guard = new Set<number>();
    let cur = parent;
    while (cur != null && !guard.has(cur)) {
      guard.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      out.push(node);
      cur = effParent.get(node.id) ?? null;
    }
    return out.reverse();
  }, [parent, byId, effParent]);

  // Start where the current choice already is, so re-opening does not send you
  // back to the top of the building.
  useEffect(() => {
    if (value == null) return;
    const cur = byId.get(value);
    if (cur) setParent(effParent.get(cur.id) ?? null);
  }, [value, byId, effParent]);

  const q = query.trim().toLowerCase();
  const results = q
    ? locations
        .filter((l) => l.name.toLowerCase().includes(q))
        .slice(0, 40)
        .map((l) => ({ loc: l, path: locationPathLabel(l.id, locations) }))
    : [];

  const shown = childrenOf.get(parent) || [];
  const here = parent != null ? locations.find((l) => l.id === parent) : null;

  const choose = (l: TreeNode) => onPick(l.id, locationPathLabel(l.id, locations));

  // Nothing set up yet — say so instead of showing an empty box.
  const empty = locations.length === 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full bg-white rounded-t-3xl max-h-[90vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-3">
          <span className="text-[var(--fs-lg)] font-bold text-gray-900">{title}</span>
          <button onClick={onClose} className="ml-auto text-[var(--fs-sm)] font-semibold text-gray-500 active:opacity-70">
            Cancel
          </button>
        </div>

        {!empty && (
          <div className="px-4 pt-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-3.5 text-[var(--fs-base)] outline-none focus:border-green-600"
            />
          </div>
        )}

        {/* Where you are, so a deep shelf is never anonymous. */}
        {/* Rendered whenever you are not at the top, even if the trail above
            cannot be reconstructed — otherwise a broken tree leaves you with no
            way back but Cancel. */}
        {!q && parent != null && (
          <div className="px-4 pt-2.5 flex flex-wrap items-center gap-1 text-[var(--fs-xs)] font-semibold text-gray-500">
            <button onClick={() => setParent(null)} className="active:opacity-70">All places</button>
            {trail.map((t, i) => (
              <React.Fragment key={t.id}>
                <span className="text-gray-300">›</span>
                <button
                  onClick={() => setParent(i === trail.length - 1 ? effParent.get(t.id) ?? null : t.id)}
                  className={`active:opacity-70 ${i === trail.length - 1 ? 'text-gray-900 font-bold' : ''}`}
                >
                  {t.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
          {empty ? (
            <p className="text-center text-[var(--fs-sm)] text-gray-500 py-10 px-4">
              {emptyLabel}
            </p>
          ) : q ? (
            results.length === 0 ? (
              <p className="text-center text-[var(--fs-sm)] text-gray-500 py-10">Nothing matches {'“'}{query}{'”'}.</p>
            ) : (
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                {results.map(({ loc, path }) => (
                  <button key={loc.id} onClick={() => choose(loc)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 border-b border-gray-100 last:border-b-0 text-left active:bg-gray-50">
                    <span aria-hidden="true">{iconOf ? iconOf(loc) : '📁'}</span>
                    <span className="min-w-0">
                      <span className="block text-[var(--fs-base)] font-semibold text-gray-900 truncate">{loc.name}</span>
                      <span className="block text-[var(--fs-xs)] text-gray-400 truncate">{path}</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <>
              {/* Stop here: an item can live in "the walk-in" without a shelf. */}
              {here && (
                <button onClick={() => choose(here)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 mb-2 rounded-2xl border border-green-200 bg-green-50 text-left active:bg-green-100">
                  <span aria-hidden="true">📍</span>
                  <span className="text-[var(--fs-base)] font-bold text-green-800 min-w-0 truncate">
                    {hereLabel(here)}
                  </span>
                </button>
              )}
              {shown.length === 0 ? (
                <p className="text-center text-[var(--fs-sm)] text-gray-500 py-8">Nothing inside this one.</p>
              ) : (
                <div className="border border-gray-200 rounded-2xl overflow-hidden">
                  {shown.map((l) => {
                    const inside = countUnder.get(l.id) || 0;
                    return (
                      <div key={l.id} className="flex items-stretch border-b border-gray-100 last:border-b-0">
                        <button onClick={() => choose(l)}
                          className="flex-1 flex items-center gap-2.5 px-3.5 py-3 text-left min-w-0 active:bg-gray-50">
                          <span aria-hidden="true">{iconOf ? iconOf(l) : '📁'}</span>
                          <span className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{l.name}</span>
                        </button>
                        {inside > 0 && (
                          <button onClick={() => { setParent(l.id); }}
                            aria-label={`Open ${l.name}`}
                            className="flex items-center gap-1.5 pl-2 pr-3.5 text-gray-400 active:bg-gray-50">
                            <span className="text-[var(--fs-xs)] font-bold">{inside}</span>
                            <span className="font-bold">{'›'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The chosen place, shown as its full path with the last part emphasised. */
export function LocationPathButton({
  locations, value, placeholder = 'Choose a place', onOpen,
}: {
  locations: PickableLocation[];
  value: number | null;
  placeholder?: string;
  onOpen: () => void;
}) {
  const node = value == null ? null : locations.find((l) => l.id === value) || null;
  const full = node ? locationPathLabel(node.id, locations) : '';
  const above = node && full.includes(' › ') ? full.slice(0, full.lastIndexOf(' › ')) : '';
  return (
    <button type="button" onClick={onOpen}
      className="w-full min-h-[48px] bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 text-left active:bg-gray-100">
      <span aria-hidden="true">{node ? typeIcon(node.kind) : '📍'}</span>
      <span className="min-w-0 flex-1">
        {node ? (
          <>
            {above && <span className="block text-[var(--fs-xs)] text-gray-400 truncate">{above}</span>}
            <span className="block text-[var(--fs-base)] font-bold text-gray-900 truncate">{node.name}</span>
          </>
        ) : (
          <span className="block text-[var(--fs-base)] text-gray-400">{placeholder}</span>
        )}
      </span>
      <span className="text-gray-400 font-bold flex-shrink-0">{'›'}</span>
    </button>
  );
}
