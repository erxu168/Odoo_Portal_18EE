'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';
import ProductDetail from './ProductDetail';
import { useCompany } from '@/lib/company-context';

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
        const locs: any[] = locRes.locations || [];
        const byId = new Map<number, any>(locs.map((l) => [l.id, l]));
        const labels: Record<number, string> = {};
        locs.forEach((l) => {
          const parent = l.parent_id != null ? byId.get(l.parent_id) : null;
          labels[l.id] = parent ? `${parent.name} · ${l.name}` : l.name;
        });
        setSpotLabels(labels);
      } catch { /* chips degrade gracefully */ }
    })();
    return () => { stale = true; };
  }, [companyId]);
  const [imgVer, setImgVer] = useState(0);                                      // cache-bust <img> after an update
  const [search, setSearch] = useState('');
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
        (flagRes.flags || []).forEach((f: any) => { photoMap[f.odoo_product_id] = !!f.requires_photo; });
        setFlags(photoMap);
      } catch (err) {
        console.error('Failed to load product settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId]);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(q));
  }, [products, search]);

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

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search" />
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
                        <span key={sid} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">📍 {spotLabels[sid] || `Spot ${sid}`}</span>
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
            if (patch.spots) setHomeSpots((prev) => ({ ...prev, [detailFor.id]: patch.spots as number[] }));
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
    </div>
  );
}
