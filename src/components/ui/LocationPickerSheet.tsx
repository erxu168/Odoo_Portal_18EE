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

export function LocationPickerSheet({
  locations, value, onPick, onClose, title = 'Where is it?',
}: {
  locations: PickableLocation[];
  value: number | null;
  onPick: (id: number, label: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const [parent, setParent] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  // Start where the current choice already is, so re-opening does not send you
  // back to the top of the building.
  useEffect(() => {
    if (value == null) return;
    const cur = locations.find((l) => l.id === value);
    if (cur) setParent(cur.parent_id ?? null);
  }, [value, locations]);

  const childrenOf = useMemo(() => {
    const m = new Map<number | null, PickableLocation[]>();
    locations.forEach((l) => {
      const k = l.parent_id ?? null;
      const arr = m.get(k) || [];
      arr.push(l);
      m.set(k, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    return m;
  }, [locations]);

  const countUnder = useMemo(() => {
    const n = new Map<number, number>();
    const walk = (id: number): number => {
      const kids = childrenOf.get(id) || [];
      const total = kids.reduce((a, k) => a + 1 + walk(k.id), 0);
      n.set(id, total);
      return total;
    };
    (childrenOf.get(null) || []).forEach((r) => walk(r.id));
    return n;
  }, [childrenOf]);

  const trail = useMemo(() => {
    const out: PickableLocation[] = [];
    let cur = parent;
    const guard = new Set<number>();
    while (cur != null && !guard.has(cur)) {
      guard.add(cur);
      const node = locations.find((l) => l.id === cur);
      if (!node) break;
      out.unshift(node);
      cur = node.parent_id ?? null;
    }
    return out;
  }, [parent, locations]);

  const q = query.trim().toLowerCase();
  const results = q
    ? locations
        .filter((l) => l.name.toLowerCase().includes(q))
        .slice(0, 40)
        .map((l) => ({ loc: l, path: locationPathLabel(l.id, locations) }))
    : [];

  const shown = childrenOf.get(parent) || [];
  const here = parent != null ? locations.find((l) => l.id === parent) : null;

  const choose = (l: PickableLocation) => onPick(l.id, locationPathLabel(l.id, locations));

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
              placeholder="Search all places"
              aria-label="Search all places"
              className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-3.5 text-[var(--fs-base)] outline-none focus:border-green-600"
            />
          </div>
        )}

        {/* Where you are, so a deep shelf is never anonymous. */}
        {!q && trail.length > 0 && (
          <div className="px-4 pt-2.5 flex flex-wrap items-center gap-1 text-[var(--fs-xs)] font-semibold text-gray-500">
            <button onClick={() => setParent(null)} className="active:opacity-70">All places</button>
            {trail.map((t, i) => (
              <React.Fragment key={t.id}>
                <span className="text-gray-300">›</span>
                <button
                  onClick={() => setParent(i === trail.length - 1 ? t.parent_id ?? null : t.id)}
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
              No places have been set up yet. A manager adds them under Stock {'→'} Locations.
            </p>
          ) : q ? (
            results.length === 0 ? (
              <p className="text-center text-[var(--fs-sm)] text-gray-500 py-10">Nothing matches {'“'}{query}{'”'}.</p>
            ) : (
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                {results.map(({ loc, path }) => (
                  <button key={loc.id} onClick={() => choose(loc)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 border-b border-gray-100 last:border-b-0 text-left active:bg-gray-50">
                    <span aria-hidden="true">{typeIcon(loc.kind)}</span>
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
                    It{'’'}s right here {'—'} {here.name}
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
                          <span aria-hidden="true">{typeIcon(l.kind)}</span>
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
