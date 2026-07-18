'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, SearchBar, Stepper, Spinner, EmptyState } from './ui';
import NumpadModal from './NumpadModal';
import CrateCountSheet from './CrateCountSheet';
import BarcodeScanner from '@/components/ui/BarcodeScanner';
import PhotoCaptureStrip from './PhotoCaptureStrip';
import UnknownBarcodeSheet from './UnknownBarcodeSheet';
import OfflineBanner from './OfflineBanner';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { useCompany } from '@/lib/company-context';
import { offlineSafeMutate } from '@/lib/inventory-offline-fetch';
import { hasCrate, crateTotal, splitFromTotal, formatSplit, baseIsMeasure } from '@/lib/crate-units';

interface QuickCountProps {
  userRole: string;
}

export default function QuickCount({ userRole }: QuickCountProps) {
  const { companyId, loading: companyLoading } = useCompany();
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [locFilter, setLocFilter] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [numpad, setNumpad] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [photos, setPhotos] = useState<Record<number, string[]>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // -- Crate (multi-UoM) counting --
  const [crateSizes, setCrateSizes] = useState<Record<number, number>>({});
  const [crateLabels, setCrateLabels] = useState<Record<number, string>>({});
  const [crateSplits, setCrateSplits] = useState<Record<number, { crates: number; loose: number }>>({});
  const [crateSheet, setCrateSheet] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });

  // ── Barcode scanner ──
  const [showScanner, setShowScanner] = useState(false);
  const [hwBarcode, setHwBarcode] = useState<string | undefined>();
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [scanToast, setScanToast] = useState<{ msg: string; kind: 'ok' | 'warn' } | null>(null);

  // ── Offline / sync queue ──
  const sync = useSyncQueue();

  function showScanToast(msg: string, kind: 'ok' | 'warn' = 'ok') {
    setScanToast({ msg, kind });
    setTimeout(() => setScanToast(null), 2500);
  }

  // Hardware scanner — process silently (no camera overlay)
  async function handleHardwareScan(barcode: string) {
    if (unknownBarcode) return; // a sheet is already open

    // 1. Match against products already in the counting list
    const local = products.find((p) => p.barcode && p.barcode === barcode);
    if (local) {
      const uom = local.uom_id?.[1] || 'Units';
      setCounts((prev) => ({ ...prev, [local.id]: (prev[local.id] ?? 0) + 1 }));
      showScanToast(`${local.name} +1 ${uom}`, 'ok');
      try { navigator.vibrate(60); } catch { /* ignore */ }
      return;
    }

    // 2. Look it up in Odoo (online only — needs a fresh server call)
    if (!sync.online) {
      showScanToast(`Offline — can't look up new barcode`, 'warn');
      try { navigator.vibrate([60, 30, 60]); } catch { /* ignore */ }
      return;
    }
    try {
      const res = await fetch(`/api/inventory/barcode-lookup?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (data.found && data.product) {
        const prod = data.product;
        // Add to local list so the stepper row appears + count it
        setProducts((prev) => prev.find((p) => p.id === prod.id) ? prev : [...prev, prod]);
        setCounts((prev) => ({ ...prev, [prod.id]: (prev[prod.id] ?? 0) + 1 }));
        const uom = prod.uom_id?.[1] || 'Units';
        const tag = data.is_draft ? ' (pending review)' : '';
        showScanToast(`${prod.name} +1 ${uom}${tag}`, data.is_draft ? 'warn' : 'ok');
        try { navigator.vibrate(60); } catch { /* ignore */ }
        return;
      }
    } catch (_err) { /* fall through to unknown */ }

    // 3. Unknown → open the create-new-product sheet (needs network for Odoo)
    setUnknownBarcode(barcode);
    try { navigator.vibrate([60, 30, 60]); } catch { /* ignore */ }
  }

  function handleUnknownCreated(product: any, qtyValue: number, pkgPhotos: string[]) {
    // Add to local product list + record count locally. Attach the
    // front + back package photos to this line so the manager sees
    // them next to the count during review.
    setProducts((prev) => prev.find((p) => p.id === product.id) ? prev : [...prev, product]);
    setCounts((prev) => ({ ...prev, [product.id]: qtyValue }));
    if (pkgPhotos.length > 0) {
      setPhotos((prev) => ({ ...prev, [product.id]: pkgPhotos }));
    }
    setUnknownBarcode(null);
    const uom = product.uom_id?.[1] || 'Units';
    showScanToast(`${product.name} added · ${qtyValue} ${uom}`, 'ok');
  }

  useHardwareScanner({
    enabled: !numpad.open && !showScanner && !unknownBarcode && !loading,
    onScan: handleHardwareScan,
  });

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [prodRes, locRes, flagRes] = await Promise.all([
        fetch(`/api/inventory/products?company_id=${companyId}`).then((r) => r.json()),
        fetch(`/api/inventory/locations?company_id=${companyId}`).then((r) => r.json()),
        fetch('/api/inventory/product-flags').then((r) => r.json()),
      ]);
      setProducts((prodRes.products || []).filter((p: any) => p.active !== false));
      const locs = locRes.locations || [];
      setLocations(locs);
      setLocFilter(locs.length > 0 ? locs[0].id : null);
      const flagMap: Record<number, boolean> = {};
      const crateMap: Record<number, number> = {};
      const labelMap: Record<number, string> = {};
      (flagRes.flags || []).forEach((f: any) => {
        flagMap[f.odoo_product_id] = !!f.requires_photo;
        if (f.units_per_crate != null && Number(f.units_per_crate) > 0) crateMap[f.odoo_product_id] = Number(f.units_per_crate);
        if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
      });
      setFlags(flagMap);
      setCrateSizes(crateMap);
      setCrateLabels(labelMap);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const categories = React.useMemo(() => {
    const cats = new Map<number, string>();
    products.forEach((p) => { if (p.categ_id) cats.set(p.categ_id[0], p.categ_id[1]); });
    return Array.from(cats.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = [...products];
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') list = list.filter((p) => p.categ_id?.[0] === Number(catFilter));
    return list;
  }, [products, search, catFilter]);

  const countedN = Object.keys(counts).length;
  const locName = locations.find((l) => l.id === locFilter)?.complete_name?.split('/')[0] || '';

  function stepQty(pid: number, delta: number) {
    setCounts((prev) => {
      const current = prev[pid] ?? 0;
      const next = Math.max(0, current + delta);
      if (next === 0 && (prev[pid] === undefined || prev[pid] === 0) && delta < 0) return prev;
      const copy = { ...prev };
      copy[pid] = next;
      return copy;
    });
  }

  function openNumpad(product: any) {
    setNumpad({ open: true, product });
  }

  function openCrateSheet(product: any) {
    setCrateSheet({ open: true, product });
  }

  function saveCrateCount(product: any, crates: number, loose: number) {
    const size = crateSizes[product.id] || 0;
    const total = crateTotal(crates, loose, size);
    setCrateSheet({ open: false, product: null });
    if (total <= 0) {
      setCounts((prev) => { const copy = { ...prev }; delete copy[product.id]; return copy; });
      setCrateSplits((prev) => { const copy = { ...prev }; delete copy[product.id]; return copy; });
      return;
    }
    setCounts((prev) => ({ ...prev, [product.id]: total }));
    setCrateSplits((prev) => ({ ...prev, [product.id]: { crates, loose } }));
  }

  function handleNumpadSave(value: number | null) {
    if (numpad.product) {
      setCounts((prev) => {
        const copy = { ...prev };
        if (value === null) delete copy[numpad.product!.id];
        else copy[numpad.product!.id] = value;
        return copy;
      });
    }
    setNumpad({ open: false, product: null });
  }

  // Called by scanner overlay when user confirms a count
  function handleScanCount(productId: number, qty: number, _uom: string) {
    setCounts((prev) => ({ ...prev, [productId]: qty }));
  }

  async function handleSubmit() {
    if (!locFilter || countedN === 0) return;
    const missingPhotos = Object.entries(counts).filter(([pid, qty]) => {
      const productId = Number(pid);
      return flags[productId] && qty > 0 && (photos[productId]?.length || 0) === 0;
    });
    if (missingPhotos.length > 0) {
      setSubmitError(`${missingPhotos.length} item${missingPhotos.length !== 1 ? 's' : ''} still need a photo.`);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const entries = Object.entries(counts).map(([pid, qty]) => {
        const productId = Number(pid);
        const p = products.find((pr) => pr.id === productId);
        const size = crateSizes[productId];
        const split = crateSplits[productId];
        return {
          product_id: productId,
          counted_qty: qty,
          uom: p?.uom_id?.[1] || 'Units',
          photos: photos[productId] || [],
          ...(split && hasCrate(size) ? { crate_qty: split.crates, loose_qty: split.loose, units_per_crate: size } : {}),
        };
      });
      const res = await offlineSafeMutate({
        url: '/api/inventory/quick-count',
        method: 'POST',
        body: { entries, location_id: locFilter },
        // No dedupKey — each batch is a distinct submit. If the user offline-
        // submits twice, both should replay.
      });
      if (!res.ok && !res.queued) {
        setSubmitError(res.error || 'Submit failed');
        return;
      }
      setCounts({});
      setPhotos({});
      setCrateSplits({});
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
      if (res.queued) void sync.refresh();
    } catch (err) {
      console.error('Quick count submit failed:', err);
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || companyLoading) return <Spinner />;

  if (!companyId) {
    return (
      <div className="flex flex-col min-h-0 flex-1 px-4 pt-6">
        <EmptyState
          title="No company selected"
          body="Pick a company in the top-right selector to start counting. If nothing appears there, ask an admin to assign a company to your account."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <OfflineBanner sync={sync} />

      {/* Location pills — only shown when the active company has multiple
          internal locations. Company scope comes from the top-bar selector. */}
      {locations.length > 1 && (
        <FilterBar>
          {locations.map((loc) => (
            <FilterPill key={loc.id}
              active={locFilter === loc.id}
              label={loc.complete_name?.split('/').slice(-1)[0] || loc.name}
              onClick={() => setLocFilter(loc.id)} />
          ))}
        </FilterBar>
      )}

      <SearchBar value={search} onChange={setSearch} placeholder="Type product name..." />

      {/* Category pills */}
      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === String(c.id)} label={c.name} onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>
      )}

      {/* Counted badge */}
      {countedN > 0 && (
        <div className="px-4 pb-2">
          <span className="text-[var(--fs-sm)] font-semibold text-green-700">{countedN} product{countedN !== 1 ? 's' : ''} counted</span>
        </div>
      )}

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {submitted && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3 text-center">
            <span className="text-[var(--fs-base)] font-semibold text-green-700">
              {sync.online ? 'Quick counts submitted for review' : 'Saved offline — will submit when back online'}
            </span>
          </div>
        )}
        {filtered.length === 0 ? (
          <EmptyState title="No products found" body="Try a different search or category" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p) => {
              const val = counts[p.id] ?? null;
              const uom = p.uom_id?.[1] || 'Units';
              const catName = p.categ_id?.[1] || '';
              const flagged = !!flags[p.id];
              const prodPhotos = photos[p.id] || [];
              const size = crateSizes[p.id];
              const isCrate = hasCrate(size);
              const label = crateLabels[p.id] ?? (baseIsMeasure(uom) ? 'piece' : 'crate');
              const measure = baseIsMeasure(uom);
              const split = crateSplits[p.id] ?? (val != null ? splitFromTotal(val, size) : null);
              return (
                <div key={p.id} className="py-3 border-b border-gray-100 [content-visibility:auto] [contain-intrinsic-size:auto_60px]">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</span>
                        {isCrate && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex-shrink-0">
                            1 {label} {measure ? '≈' : '='} {size}
                          </span>
                        )}
                        {flagged && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                            Photo required
                          </span>
                        )}
                      </div>
                      <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{catName}</div>
                    </div>
                    {isCrate ? (
                      <button
                        onClick={() => openCrateSheet(p)}
                        className={`flex-shrink-0 text-right border rounded-xl px-3 py-2 min-w-[94px] active:bg-gray-50 ${val != null ? 'border-green-500 bg-green-50' : 'border-dashed border-gray-300'}`}
                      >
                        {val != null ? (
                          <>
                            <div className="font-mono text-[var(--fs-lg)] font-bold text-gray-900 leading-none">
                              {val}<span className="text-[10px] font-semibold text-gray-500 ml-0.5">{uom}</span>
                            </div>
                            {split && <div className="text-[10px] text-gray-500 mt-1 font-mono">{formatSplit(split.crates, split.loose, uom, label)}</div>}
                          </>
                        ) : (
                          <div className="text-[var(--fs-sm)] font-bold text-green-700">Count {'→'}</div>
                        )}
                      </button>
                    ) : (
                      <Stepper value={val} uom={uom}
                        onMinus={() => stepQty(p.id, -1)}
                        onPlus={() => stepQty(p.id, 1)}
                        onTap={() => openNumpad(p)} />
                    )}
                  </div>
                  {flagged && (val ?? 0) > 0 && (
                    <div className="mt-2">
                      <PhotoCaptureStrip
                        photos={prodPhotos}
                        onChange={(next) => setPhotos(prev => ({ ...prev, [p.id]: next }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submit bar */}
      {countedN > 0 && (
        <div className="px-4 py-3">
          {submitError && (
            <div className="mb-2 bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <span className="text-[var(--fs-sm)] font-semibold text-red-700">{submitError}</span>
            </div>
          )}
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
            {submitting ? 'Submitting...' : `Submit ${countedN} quick count${countedN !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Camera scan FAB — only opens the camera; BT scans are processed
          silently and never open this overlay */}
      <button
        onClick={() => setShowScanner(true)}
        className="fixed bottom-28 right-5 z-[30] w-14 h-14 rounded-full bg-[#2563EB] text-white shadow-lg shadow-blue-600/40 flex items-center justify-center active:scale-95 active:bg-blue-700 transition-transform"
        aria-label="Camera scan"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 7V5a2 2 0 012-2h2"/>
          <path d="M17 3h2a2 2 0 012 2v2"/>
          <path d="M21 17v2a2 2 0 01-2 2h-2"/>
          <path d="M7 21H5a2 2 0 01-2-2v-2"/>
          <line x1="7" y1="12" x2="17" y2="12"/>
          <line x1="7" y1="8" x2="10" y2="8"/>
          <line x1="14" y1="8" x2="17" y2="8"/>
          <line x1="7" y1="16" x2="10" y2="16"/>
          <line x1="14" y1="16" x2="17" y2="16"/>
        </svg>
      </button>

      {/* Camera scanner overlay — only opens via the FAB above */}
      <BarcodeScanner
        open={showScanner}
        onClose={() => { setShowScanner(false); setHwBarcode(undefined); }}
        products={products}
        entries={counts}
        totalCount={products.length}
        countedCount={countedN}
        onCount={handleScanCount}
        userRole={userRole}
        title="Scan product"
      />

      {/* Hardware scanner — silent scan toast at the bottom */}
      {scanToast && (
        <div className="fixed bottom-24 left-4 right-4 z-[60] flex justify-center pointer-events-none">
          <div className={`px-4 py-2.5 rounded-xl shadow-lg pointer-events-auto ${
            scanToast.kind === 'warn'
              ? 'bg-amber-500 text-white'
              : 'bg-green-600 text-white'
          }`}>
            <span className="text-[14px] font-semibold">{scanToast.msg}</span>
          </div>
        </div>
      )}

      {/* Hardware scanner — create new product sheet (no camera) */}
      {unknownBarcode && (
        <UnknownBarcodeSheet
          barcode={unknownBarcode}
          onCancel={() => setUnknownBarcode(null)}
          onCreated={handleUnknownCreated}
          standalone
        />
      )}

      {/* Numpad */}
      <NumpadModal
        open={numpad.open}
        productName={numpad.product?.name || ''}
        category={numpad.product?.categ_id?.[1] || ''}
        uom={numpad.product?.uom_id?.[1] || 'Units'}
        initialValue={numpad.product ? (counts[numpad.product.id] ?? null) : null}
        showSystemQty={userRole !== 'staff'}
        systemQty={null}
        locationName={locName}
        onSave={handleNumpadSave}
        onClose={() => setNumpad({ open: false, product: null })}
      />

      {/* Crate + loose count sheet */}
      {crateSheet.open && crateSheet.product && (
        <CrateCountSheet
          open={crateSheet.open}
          product={crateSheet.product}
          unitsPerCrate={crateSizes[crateSheet.product.id] || 0}
          uom={crateSheet.product.uom_id?.[1] || 'Units'}
          packLabel={crateLabels[crateSheet.product.id] ?? (baseIsMeasure(crateSheet.product.uom_id?.[1] || 'Units') ? 'piece' : 'crate')}
          initialCrates={crateSplits[crateSheet.product.id]?.crates ?? splitFromTotal(counts[crateSheet.product.id] ?? 0, crateSizes[crateSheet.product.id]).crates}
          initialLoose={crateSplits[crateSheet.product.id]?.loose ?? splitFromTotal(counts[crateSheet.product.id] ?? 0, crateSizes[crateSheet.product.id]).loose}
          showSystemQty={false}
          systemQty={null}
          locationName={locName}
          onSave={(crates, loose) => saveCrateCount(crateSheet.product, crates, loose)}
          onClose={() => setCrateSheet({ open: false, product: null })}
        />
      )}
    </div>
  );
}
