'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CategoryPickerSheet, type CategoryRow } from './CategoryPicker';
import { unitWords } from '@/lib/crate-units';
import { LocationPickerSheet, type PickableLocation } from '@/components/ui/LocationPickerSheet';
import { SearchBar, Spinner, EmptyState } from './ui';
import ProductDetail from './ProductDetail';
import { useCompany } from '@/lib/company-context';
import { locationPathLabel } from '@/lib/location-tree';
import { plainFromOdooHtml } from '@/lib/odoo-html';

interface ProductSettingsProps {
  onBack: () => void;
  /** Open the batch photo grid. Omitted where the screen has no route to it. */
  onBatchPhotos?: () => void;
}

export default function ProductSettings({ onBack, onBatchPhotos }: ProductSettingsProps) {
  const { companyId } = useCompany();
  const [products, setProducts] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [imageIds, setImageIds] = useState<Set<number>>(new Set());             // product ids that have a picture
  // HOME SPOTS — the global product↔spot record (same one the list builder and
  // the Locations screen edit). Shown as read-only chips; edited on the form.
  const [homeSpots, setHomeSpots] = useState<Record<number, number[]>>({});
  const [spotLabels, setSpotLabels] = useState<Record<number, string>>({});
  const [detailFor, setDetailFor] = useState<any | null>(null);        // product page

  // Labels are derived from the CURRENT location tree, so any screen that can
  // create or rename a location must refresh them — otherwise a new spot shows
  // as "Spot 42" and a renamed one keeps its old text until remount.
  const applyLocations = React.useCallback((locs: any[]) => {
    // Ethan: always show the FULL path in location chips (no "…" abbreviation).
    const labels: Record<number, string> = {};
    locs.forEach((l) => { labels[l.id] = locationPathLabel(l.id, locs); });
    setSpotLabels(labels);
  }, []);

  const refreshLocationLabels = React.useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await fetch(`/api/inventory/count-locations?company_id=${companyId}`);
      if (r.ok) applyLocations((await r.json()).locations || []);
    } catch { /* keep the labels we have */ }
  }, [companyId, applyLocations]);

  useEffect(() => {
    if (!companyId) return;
    let stale = false;
    // Reset first — a failed load must show "no data", never the PREVIOUS
    // restaurant's chips.
    setHomeSpots({});
    setSpotLabels({});
    (async () => {
      try {
        const [plRes, locRes] = await Promise.all([
          fetch(`/api/inventory/product-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('placements'))),
          fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('locations'))),
        ]);
        if (stale) return;
        const map: Record<number, number[]> = {};
        (plRes.placements || []).forEach((pl: any) => { (map[pl.odoo_product_id] ||= []).push(pl.count_location_id); });
        setHomeSpots(map);
        applyLocations(locRes.locations || []);
      } catch { /* chips degrade gracefully */ }
    })();
    return () => { stale = true; };
  }, [companyId, applyLocations]);
  const [imgVer, setImgVer] = useState(0);                                      // cache-bust <img> after an update
  const [search, setSearch] = useState('');
  const [hasPack, setHasPack] = useState<Record<number, boolean>>({});
  const [packSizes, setPackSizes] = useState<Record<number, number>>({});
  const [packLabels, setPackLabels] = useState<Record<number, string>>({});
  const [looseWords, setLooseWords] = useState<Record<number, string>>({});
  // This screen's real job is finding what still needs setting up, so the
  // filters are gaps first ("no spot yet") and only then narrowing by where a
  // product lives or what it is.
  const [gap, setGap] = useState<null | 'spot' | 'pack' | 'photo' | 'picture'>(null);
  const [catId, setCatId] = useState<number | null>(null);
  const [locId, setLocId] = useState<number | null>(null);
  const [catPick, setCatPick] = useState(false);
  // Why a row just vanished. The editor's own flash goes with the editor when
  // it closes, so the confirmation has to live on the screen that changed — and
  // for archiving it carries the way back, because nothing in the portal lists
  // archived products. Without an Undo, two taps hide a product and its spots,
  // pack size, picture and note with no route back except typing its id in the
  // address bar.
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /** Put an archived product back, from the toast. */
  const unarchive = React.useCallback(async (id: number, nm: string) => {
    setToast(null);
    try {
      const res = await fetch(`/api/inventory/products/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });
      if (!res.ok) { setToast({ text: `Could not bring "${nm}" back — open it from Products to try again.` }); return; }
      setProducts((prev: any[]) => prev.map((x) => x.id === id ? { ...x, active: true } : x));
      setToast({ text: `"${nm}" is back.` });
    } catch {
      setToast({ text: `Network error — "${nm}" is still archived.` });
    }
  }, []);
  const [locPick, setLocPick] = useState(false);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [locs, setLocs] = useState<PickableLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // WAIT for the restaurant. Without this the first paint fetched unscoped and
    // showed all 500 products — every restaurant's — under a header naming one.
    // The ribbon is the source of truth, so nothing is listed until it has spoken.
    if (!companyId) return;
    async function load() {
      setLoading(true);
      try {
        const [prodRes, flagRes, imgRes] = await Promise.all([
          fetch(`/api/inventory/products?limit=500&include_pos=1&company_id=${companyId}&relevant=1`).then(r => r.json()),
          fetch('/api/inventory/product-flags').then(r => r.json()),
          fetch('/api/inventory/product-images').then(r => r.json()).catch(() => ({ with_images: [] })),
        ]);
        setImageIds(new Set<number>(imgRes.with_images || []));
        const prods = (prodRes.products || []).filter((p: any) => p.active !== false);
        setProducts(prods);
        const photoMap: Record<number, boolean> = {};
        const packMap: Record<number, boolean> = {};
        const sizeMap: Record<number, number> = {};
        const labelMap: Record<number, string> = {};
        const looseMap: Record<number, string> = {};
        (flagRes.flags || []).forEach((f: any) => {
          photoMap[f.odoo_product_id] = !!f.requires_photo;
          packMap[f.odoo_product_id] = f.units_per_crate != null && Number(f.units_per_crate) > 0;
          if (f.units_per_crate != null) sizeMap[f.odoo_product_id] = Number(f.units_per_crate);
          if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
          if (f.loose_label) looseMap[f.odoo_product_id] = f.loose_label;
        });
        setFlags(photoMap);
        setHasPack(packMap);
        setPackSizes(sizeMap);
        setPackLabels(labelMap);
        setLooseWords(looseMap);
      } catch (err) {
        console.error('Failed to load product settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId]);

  useEffect(() => {
    fetch('/api/inventory/categories').then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setCats(d.categories || [])).catch(() => {});
    fetch(`/api/inventory/count-locations${companyId ? `?company_id=${companyId}` : ''}`)
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => setLocs(d.locations || [])).catch(() => {});
  }, [companyId]);

  // Every place under the chosen one counts as a match — picking "WAJ Kitchen"
  // should find something in a drawer inside a fridge inside it.
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

  const catFamily = useMemo(() => {
    if (catId == null) return null;
    const chosen = cats.find((c) => c.id === catId);
    if (!chosen) return new Set<number>([catId]);
    const mine = String(chosen.complete_name || chosen.name);
    const out = new Set<number>([catId]);
    cats.forEach((c) => { if (String(c.complete_name || c.name).startsWith(mine + ' / ')) out.add(c.id); });
    return out;
  }, [catId, cats]);

  /**
   * How this product is counted, said the way a person would. The row used to
   * print "base Units", which is Odoo's internal term for the unit stock is
   * stored in, followed by Odoo's unnamed default — so it told a manager
   * nothing while appearing on every line.
   */
  const countedAs = (p: any) => {
    const uom = p.uom_id?.[1] || 'Units';
    const w = unitWords(uom, packLabels[p.id], looseWords[p.id]);
    const size = packSizes[p.id];
    if (size && size > 0) return `1 ${w.pack} = ${size} ${w.looseFor(size)}`;
    return `counted in ${w.looseFor(2)}`;
  };

  const missing = useMemo(() => ({
    spot: (p: any) => (homeSpots[p.id] || []).length === 0,
    pack: (p: any) => !hasPack[p.id],
    photo: (p: any) => !flags[p.id],
    picture: (p: any) => !imageIds.has(p.id),
  }), [homeSpots, hasPack, flags, imageIds]);

  // The one live set. Everything that counts products on this screen — the
  // rows, the chips and the "of N" denominator — must start from the SAME base,
  // or archiving one product makes the line read "38 products of 39" with no
  // filter on.
  const live = useMemo(() => products.filter((p: any) => p.active !== false), [products]);

  const narrowed = useMemo(() => {
    let list = live;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name.toLowerCase().includes(q));
    }
    if (catFamily) list = list.filter((p: any) => catFamily.has(p.categ_id?.[0]));
    if (locFamily) list = list.filter((p: any) => (homeSpots[p.id] || []).some((sid) => locFamily.has(sid)));
    return list;
  }, [live, search, catFamily, locFamily, homeSpots]);

  // Counts are of what the OTHER filters already left, so a chip never promises
  // more than tapping it delivers.
  const gapCounts = useMemo(() => ({
    spot: narrowed.filter(missing.spot).length,
    pack: narrowed.filter(missing.pack).length,
    photo: narrowed.filter(missing.photo).length,
    picture: narrowed.filter(missing.picture).length,
  }), [narrowed, missing]);

  const filtered = useMemo(
    () => (gap ? narrowed.filter(missing[gap]) : narrowed),
    [narrowed, gap, missing],
  );

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Product settings</h1>
      </div>

      <div className="px-4 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C2410C" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
        <span>Set how staff count each product {'\u2014'} in bottles, bunches or crates, whichever they actually pick up. Open one to change it.</span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      {/* Gaps first. On a setup screen the question is almost never "show me
          product X" — it is "what have I not finished?". Each chip carries the
          number it would leave, counted after the other filters. */}
      {/* One of these is always chosen, so "All" belongs in the set — otherwise
          the only way back is tapping the active one again, which nobody finds. */}
      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Show">
        {onBatchPhotos && (
          <button onClick={onBatchPhotos}
            className="flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border bg-blue-50 border-blue-300 text-blue-800">
            🖼️ Batch photos
          </button>
        )}
        <button onClick={() => setGap(null)} aria-pressed={gap === null}
          className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border transition-colors ${
            gap === null ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600'
          }`}>
          All {narrowed.length}
        </button>
        {([
          ['spot', 'No spot', gapCounts.spot],
          ['pack', 'No pack size', gapCounts.pack],
          ['photo', 'No photo rule', gapCounts.photo],
          ['picture', 'No picture', gapCounts.picture],
        ] as const).map(([key, label, n]) => (
          <button key={key} onClick={() => setGap(gap === key ? null : key)} aria-pressed={gap === key}
            className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border transition-colors ${
              gap === key ? 'bg-amber-600 border-amber-600 text-white'
                : n > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-white border-gray-200 text-gray-400'
            }`}>
            {label} {n}
          </button>
        ))}
      </div>

      {/* …then narrowing by what a product IS, or where it lives. */}
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
        {(gap || catId != null || locId != null) && (
          <button onClick={() => { setGap(null); setCatId(null); setLocId(null); }}
            className="flex-shrink-0 h-9 px-3 rounded-lg text-[var(--fs-xs)] font-bold text-gray-500 active:opacity-70">
            Clear
          </button>
        )}
      </div>

      <p className="px-4 pb-1 text-[var(--fs-xs)] text-gray-500">
        {gap ? (
          <>
            Showing <strong className="text-gray-900">{filtered.length}</strong> product{filtered.length === 1 ? '' : 's'} with{' '}
            {{ spot: 'no spot set', pack: 'no pack size', photo: 'no photo rule', picture: 'no picture' }[gap]}
            {narrowed.length !== filtered.length && <> {'\u00B7'} {narrowed.length - filtered.length} hidden</>}
          </>
        ) : (
          <>{filtered.length} product{filtered.length === 1 ? '' : 's'}{filtered.length !== live.length && <> of {live.length}</>}</>
        )}
      </p>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="Nothing matches"
            body={gap || catId != null || locId != null ? 'Clear a filter, or try a different search.' : 'Try a different search'} />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p: any) => {
              const on = !!flags[p.id];
              const uom = p.uom_id?.[1] || 'Units';
              const spots = homeSpots[p.id] || [];
              // The list is navigation ONLY — every product setting lives on the
              // single product form (tap to open). Read-only summary here.
              return (
                <button key={p.id} onClick={() => setDetailFor(p)}
                  aria-label={`Open ${p.name}`}
                  className="w-full py-3 border-b border-gray-100 flex items-center gap-3 text-left active:bg-gray-50 [content-visibility:auto] [contain-intrinsic-size:auto_76px]">
                  <div className="w-11 h-11 rounded-lg bg-gray-100 border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden">
                    {imageIds.has(p.id)
                      ? <img src={`/api/inventory/product-images/${p.id}?v=${imgVer}`} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[18px]">📷</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 truncate">{p.categ_id?.[1] || ''}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5 truncate">{countedAs(p)}</div>
                    {plainFromOdooHtml(p.description) && (
                      <div className="text-[var(--fs-xs)] text-blue-700 mt-0.5 truncate">📝 {plainFromOdooHtml(p.description)}</div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {on && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200">📷 Photo required</span>}
                      {spots.length > 0 ? spots.map((sid) => (
                        <span key={sid} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 max-w-full break-words">📍 {spotLabels[sid] || `Spot ${sid}`}</span>
                      )) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-dashed border-amber-300">📍 No spot yet</span>
                      )}
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {detailFor && (
        <ProductDetail
          product={detailFor}
          hasImage={imageIds.has(detailFor.id)}
          onClose={() => setDetailFor(null)}
          onChanged={(patch) => {
            if (patch.flags) {
              const f = patch.flags;
              if (f.requires_photo !== undefined) setFlags((prev) => ({ ...prev, [detailFor.id]: !!f.requires_photo }));
            }
            if (patch.spots) {
              setHomeSpots((prev) => ({ ...prev, [detailFor.id]: patch.spots as number[] }));
              refreshLocationLabels();   // the editor can create/rename locations
            }
            if (patch.name !== undefined || patch.uom !== undefined) {
              setProducts((prev: any[]) => prev.map((x) => x.id === detailFor.id
                ? { ...x, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.uom !== undefined ? { uom_id: patch.uom } : {}) }
                : x));
            }
            // imageAdded is true for a saved photo and false for a removed one,
            // so the thumbnail follows both ways.
            if (patch.imageAdded !== undefined) {
              setImageIds((prev) => {
                const n = new Set(prev);
                if (patch.imageAdded) n.add(detailFor.id); else n.delete(detailFor.id);
                return n;
              });
              setImgVer((v) => v + 1);
            }
            // Deleted: gone for good, so the row goes and the editor closes —
            // there is no record left behind it to return to.
            if (patch.deleted) {
              const gone = detailFor.id;
              setProducts((prev: any[]) => prev.filter((x) => x.id !== gone));
              setDetailFor(null);
              setToast({ text: `"${detailFor.name}" was deleted.` });
              return;
            }
            // Archived: this screen lists live products only, so the row leaves.
            // The FLAG is what changes, not the array — bringing the product
            // back drops it straight into its old place with no bookkeeping.
            if (patch.active !== undefined) {
              const pid = detailFor.id;
              setProducts((prev: any[]) => prev.map((x) => x.id === pid ? { ...x, active: patch.active } : x));
              const nm = detailFor.name;
              setToast(patch.active
                ? { text: `"${nm}" is back.` }
                : { text: `"${nm}" archived — hidden from this list.`, undo: () => unarchive(pid, nm) });
            }
          }}
        />
      )}
      {catPick && (
        <CategoryPickerSheet
          cats={cats}
          value={catId}
          title="Filter by category"
          onPick={(id) => { setCatId(id); setCatPick(false); }}
          onClose={() => setCatPick(false)}
        />
      )}
      {locPick && (
        <LocationPickerSheet
          locations={locs}
          value={locId}
          title="Filter by place"
          onPick={(id) => { setLocId(id); setLocPick(false); }}
          onClose={() => setLocPick(false)}
        />
      )}

      {toast && (
        <div role="status"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] bg-gray-900 text-white text-[var(--fs-sm)] font-semibold pl-4 pr-2 py-2 rounded-full shadow-lg max-w-[92vw] flex items-center gap-3">
          <span className="min-w-0 truncate">{toast.text}</span>
          {toast.undo && (
            <button onClick={toast.undo}
              className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/15 text-white font-bold active:bg-white/25">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
