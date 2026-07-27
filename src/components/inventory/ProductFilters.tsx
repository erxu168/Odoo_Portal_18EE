'use client';

/**
 * The one product filter bar, for every screen that lists products.
 *
 * Two universal filters — what a product IS (category) and where it LIVES
 * (place) — plus an optional row of chips each screen defines for itself,
 * because "no photo rule" is the right question on a setup screen and a
 * meaningless one while you are unpacking a delivery.
 *
 * Built as a hook + a bar rather than copied per screen so the behaviours that
 * are easy to get wrong are got right once:
 *  - picking a parent place matches everything UNDER it (a drawer inside a
 *    fridge inside the kitchen), and the same for a parent category;
 *  - chip counts are computed against what the OTHER filters already left, so a
 *    chip never promises more than tapping it delivers;
 *  - "All" is always in the set, because "tap the active one again" is not a
 *    way back anyone finds;
 *  - the line underneath always says what you are looking at and how much is
 *    hidden.
 *
 * The hook owns the category / place / placement fetches, so a screen gets the
 * Place filter without having to know that placements are a separate table.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CategoryPickerSheet, type CategoryRow } from './CategoryPicker';
import { LocationPickerSheet, type PickableLocation } from '@/components/ui/LocationPickerSheet';

export interface ProductFilterChip {
  key: string;
  label: string;
  count: number;
  /** How the result line reads when this chip is on, e.g. "never received". */
  summary?: string;
}

export interface ProductFilters {
  catId: number | null;
  locId: number | null;
  setCatId: (id: number | null) => void;
  setLocId: (id: number | null) => void;
  cats: CategoryRow[];
  locs: PickableLocation[];
  /** productId -> the spot ids it is placed in. Shared so hosts can show chips. */
  homeSpots: Record<number, number[]>;
  /** True when category or place is narrowing the list. */
  active: boolean;
  clear: () => void;
  /** Apply category + place. Search stays with the host — placeholders differ. */
  narrow: <T extends { id: number; categ_id?: [number, string] | false }>(list: T[]) => T[];
}

export function useProductFilters(companyId: number | null | undefined): ProductFilters {
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [locs, setLocs] = useState<PickableLocation[]>([]);
  const [homeSpots, setHomeSpots] = useState<Record<number, number[]>>({});
  const [catId, setCatId] = useState<number | null>(null);
  const [locId, setLocId] = useState<number | null>(null);

  // Categories are global; places and placements belong to one restaurant.
  useEffect(() => {
    let stale = false;
    fetch('/api/inventory/categories')
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => { if (!stale) setCats(d.categories || []); })
      .catch(() => {});
    return () => { stale = true; };
  }, []);

  useEffect(() => {
    let stale = false;
    // Reset FIRST, and reset even when the company is cleared. A failed load, or
    // no restaurant at all, must show "nothing to filter by" — never the
    // previous restaurant's places. Chosen filters go too: an id from the old
    // restaurant silently matches nothing, which reads as a broken filter.
    setLocs([]); setHomeSpots({}); setLocId(null); setCatId(null);
    if (!companyId) return;
    (async () => {
      try {
        const [locRes, plRes] = await Promise.all([
          fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => (r.ok ? r.json() : { locations: [] })),
          fetch(`/api/inventory/product-locations?company_id=${companyId}`).then((r) => (r.ok ? r.json() : { placements: [] })),
        ]);
        if (stale) return;
        setLocs(locRes.locations || []);
        const map: Record<number, number[]> = {};
        (plRes.placements || []).forEach((pl: any) => { (map[pl.odoo_product_id] ||= []).push(pl.count_location_id); });
        setHomeSpots(map);
      } catch { /* the bar degrades to category-only */ }
    })();
    return () => { stale = true; };
  }, [companyId]);

  // Picking "WAJ Kitchen" must find something in a drawer inside a fridge
  // inside it, so the chosen place expands to its whole family.
  const locFamily = useMemo(() => {
    if (locId == null) return null;
    const kids = new Map<number | null, number[]>();
    locs.forEach((l) => {
      const k = l.parent_id ?? null;
      kids.set(k, [...(kids.get(k) || []), l.id]);
    });
    const out = new Set<number>([locId]);
    const stack = [locId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const kid of kids.get(cur) || []) if (!out.has(kid)) { out.add(kid); stack.push(kid); }
    }
    return out;
  }, [locId, locs]);

  // Same for categories — and matched on the full path, never by splitting on
  // "/", because six of the real categories have a "/" inside their own name
  // ("Drinks / Soft Drinks").
  const catFamily = useMemo(() => {
    if (catId == null) return null;
    const chosen = cats.find((c) => c.id === catId);
    if (!chosen) return new Set<number>([catId]);
    const mine = String(chosen.complete_name || chosen.name);
    const out = new Set<number>([catId]);
    cats.forEach((c) => { if (String(c.complete_name || c.name).startsWith(mine + ' / ')) out.add(c.id); });
    return out;
  }, [catId, cats]);

  const narrow = React.useCallback(<T extends { id: number; categ_id?: [number, string] | false }>(list: T[]): T[] => {
    let out = list;
    if (catFamily) out = out.filter((p) => {
      const cid = Array.isArray(p.categ_id) ? p.categ_id[0] : undefined;
      return cid != null && catFamily.has(cid);
    });
    if (locFamily) out = out.filter((p) => (homeSpots[p.id] || []).some((sid) => locFamily.has(sid)));
    return out;
  }, [catFamily, locFamily, homeSpots]);

  return {
    catId, locId, setCatId, setLocId, cats, locs, homeSpots,
    active: catId != null || locId != null,
    clear: () => { setCatId(null); setLocId(null); },
    narrow,
  };
}

export function ProductFilterBar({
  filters, chips = [], activeChip, onChip, base, shown, total, noun = 'product', capped,
}: {
  filters: ProductFilters;
  /** Screen-specific chips. "All" is added for you — do not pass it. */
  chips?: ProductFilterChip[];
  activeChip?: string | null;
  onChip?: (key: string | null) => void;
  /**
   * Rows left after search + category + place but BEFORE the chip — what "All"
   * would give you, and what every chip count must be measured against. Passed
   * in rather than guessed: chips are not a partition, so it cannot be derived
   * from them.
   */
  base: number;
  /** How many rows the list is about to render, chip included. */
  shown: number;
  /** How many there are in total, before any filter. */
  total: number;
  noun?: string;
  /** If the list renders at most N rows, pass N — the line says so out loud. */
  capped?: number;
}) {
  const { catId, locId, cats, locs, active, clear } = filters;
  const [catPick, setCatPick] = useState(false);
  const [locPick, setLocPick] = useState(false);

  const chipOn = chips.find((c) => c.key === activeChip);
  const hidden = Math.max(0, base - shown);
  const anything = active || !!activeChip;
  const overflow = capped != null && shown > capped;

  return (
    <>
      {chips.length > 0 && (
        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Show">
          <button onClick={() => onChip?.(null)} aria-pressed={!activeChip}
            className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border transition-colors ${
              !activeChip ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600'
            }`}>
            All {base}
          </button>
          {chips.map((c) => (
            <button key={c.key} onClick={() => onChip?.(activeChip === c.key ? null : c.key)}
              aria-pressed={activeChip === c.key}
              className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border transition-colors ${
                activeChip === c.key ? 'bg-amber-600 border-amber-600 text-white'
                  : c.count > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-white border-gray-200 text-gray-400'
              }`}>
              {c.label} {c.count}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-2 flex gap-2">
        <button onClick={() => setCatPick(true)}
          className={`flex-1 min-w-0 h-9 px-3 rounded-lg border text-left text-[var(--fs-xs)] font-bold truncate ${
            catId != null ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-500'
          }`}>
          {catId != null ? (cats.find((c) => c.id === catId)?.name || 'Category') : 'Any category'}
        </button>
        <button onClick={() => setLocPick(true)}
          className={`flex-1 min-w-0 h-9 px-3 rounded-lg border text-left text-[var(--fs-xs)] font-bold truncate ${
            locId != null ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-500'
          }`}>
          {locId != null ? (locs.find((l) => l.id === locId)?.name || 'Place') : 'Anywhere'}
        </button>
        {anything && (
          <button onClick={() => { clear(); onChip?.(null); }}
            className="flex-shrink-0 h-9 px-3 rounded-lg text-[var(--fs-xs)] font-bold text-gray-500 active:opacity-70">
            Clear
          </button>
        )}
      </div>

      <p className="px-4 pb-1 text-[var(--fs-xs)] text-gray-500">
        {chipOn ? (
          <>
            Showing <strong className="text-gray-900">{shown}</strong> {noun}{shown === 1 ? '' : 's'}
            {chipOn.summary ? ` ${chipOn.summary}` : ''}
            {hidden > 0 && <> {'·'} {hidden} hidden</>}
          </>
        ) : (
          <>
            <strong className="text-gray-900">{shown}</strong> {noun}{shown === 1 ? '' : 's'}
            {shown !== total && <> of {total}</>}
          </>
        )}
        {overflow && (
          <> {'·'} <span className="text-amber-700 font-semibold">only the first {capped} shown, narrow it down</span></>
        )}
      </p>

      {catPick && (
        <CategoryPickerSheet
          cats={cats}
          value={catId}
          title="Filter by category"
          onPick={(id) => { filters.setCatId(id); setCatPick(false); }}
          onClose={() => setCatPick(false)}
        />
      )}
      {locPick && (
        <LocationPickerSheet
          locations={locs}
          value={locId}
          title="Filter by place"
          onPick={(id) => { filters.setLocId(id); setLocPick(false); }}
          onClose={() => setLocPick(false)}
        />
      )}
    </>
  );
}
