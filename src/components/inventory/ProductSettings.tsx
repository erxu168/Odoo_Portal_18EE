'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CategoryPickerSheet, type CategoryRow } from './CategoryPicker';
import { LocationPickerSheet, type PickableLocation } from '@/components/ui/LocationPickerSheet';
import { SearchBar, Spinner, EmptyState } from './ui';
import ProductDetail from './ProductDetail';
import { useCompany } from '@/lib/company-context';
import { locationPathLabel } from '@/lib/location-tree';

interface ProductSettingsProps {
  onBack: () => void;
}

export default function ProductSettings({ onBack }: ProductSettingsProps) {
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
  // This screen's real job is finding what still needs setting up, so the
  // filters are gaps first ("no spot yet") and only then narrowing by where a
  // product lives or what it is.
  const [gap, setGap] = useState<null | 'spot' | 'pack' | 'photo' | 'picture'>(null);
  const [catId, setCatId] = useState<number | null>(null);
  const [locId, setLocId] = useState<number | null>(null);
  const [catPick, setCatPick] = useState(false);
  const [locPick, setLocPick] = useState(false);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [locs, setLocs] = useState<PickableLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [prodRes, flagRes, imgRes] = await Promise.all([
          fetch(`/api/inventory/products?limit=500&include_pos=1${companyId ? `&company_id=${companyId}&relevant=1` : ''}`).then(r => r.json()),
          fetch('/api/inventory/product-flags').then(r => r.json()),
          fetch('/api/inventory/product-images').then(r => r.json()).catch(() => ({ with_images: [] })),
        ]);
        setImageIds(new Set<number>(imgRes.with_images || []));
        const prods = (prodRes.products || []).filter((p: any) => p.active !== false);
        setProducts(prods);
        const photoMap: Record<number, boolean> = {};
        const packMap: Record<number, boolean> = {};
        (flagRes.flags || []).forEach((f: any) => {
          photoMap[f.odoo_product_id] = !!f.requires_photo;
          packMap[f.odoo_product_id] = f.units_per_crate != null && Number(f.units_per_crate) > 0;
        });
        setFlags(photoMap);
        setHasPack(packMap);
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

  const missing = useMemo(() => ({
    spot: (p: any) => (homeSpots[p.id] || []).length === 0,
    pack: (p: any) => !hasPack[p.id],
    photo: (p: any) => !flags[p.id],
    picture: (p: any) => !imageIds.has(p.id),
  }), [homeSpots, hasPack, flags, imageIds]);

  const narrowed = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name.toLowerCase().includes(q));
    }
    if (catFamily) list = list.filter((p: any) => catFamily.has(p.categ_id?.[0]));
    if (locFamily) list = list.filter((p: any) => (homeSpots[p.id] || []).some((sid) => locFamily.has(sid)));
    return list;
  }, [products, search, catFamily, locFamily, homeSpots]);

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
        <span>Let staff count a product in a handy unit (piece, bunch, crate…) that converts to its base unit. Leave the size blank to count in base units only.</span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      {/* Gaps first. On a setup screen the question is almost never "show me
          product X" — it is "what have I not finished?". Each chip carries the
          number it would leave, counted after the other filters. */}
      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
        {([
          ['spot', 'No spot', gapCounts.spot],
          ['pack', 'No pack size', gapCounts.pack],
          ['photo', 'No photo rule', gapCounts.photo],
          ['picture', 'No picture', gapCounts.picture],
        ] as const).map(([key, label, n]) => (
          <button key={key} onClick={() => setGap(gap === key ? null : key)}
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

      <p className="px-4 pb-1 text-[var(--fs-xs)] text-gray-400">
        {filtered.length} of {products.length} products
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
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 truncate">{p.categ_id?.[1] || ''} · base {uom}</div>
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
            if (patch.imageAdded) {
              setImageIds((prev) => { const n = new Set(prev); n.add(detailFor.id); return n; });
              setImgVer((v) => v + 1);
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

    </div>
  );
}
