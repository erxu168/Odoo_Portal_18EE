'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, SearchBar, Stepper, Spinner, EmptyState } from './ui';
import NumpadModal from './NumpadModal';
import BarcodeScanner from '@/components/ui/BarcodeScanner';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';
import { useCompany } from '@/lib/company-context';

interface QuickCountProps {
  userRole: string;
}

export default function QuickCount({ userRole }: QuickCountProps) {
  const { companyId } = useCompany();
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

  // ── Barcode scanner ──
  const [showScanner, setShowScanner] = useState(false);
  const [hwBarcode, setHwBarcode] = useState<string | undefined>();

  // Hardware scanner — opens scanner overlay with product card
  function handleHardwareScan(barcode: string) {
    setHwBarcode(barcode);
    setShowScanner(true);
  }

  useHardwareScanner({
    enabled: !numpad.open && !showScanner && !loading,
    onScan: handleHardwareScan,
  });

  const fetchData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [prodRes, locRes] = await Promise.all([
        fetch('/api/inventory/products').then((r) => r.json()),
        fetch(`/api/inventory/locations?company_id=${companyId}`).then((r) => r.json()),
      ]);
      setProducts((prodRes.products || []).filter((p: any) => p.active !== false));
      const locs = locRes.locations || [];
      setLocations(locs);
      // Always reset to the first location of the active company —
      // previous selection belongs to a different company.
      setLocFilter(locs.length > 0 ? locs[0].id : null);
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
    setSubmitting(true);
    try {
      const entries = Object.entries(counts).map(([pid, qty]) => {
        const p = products.find((pr) => pr.id === Number(pid));
        return { product_id: Number(pid), counted_qty: qty, uom: p?.uom_id?.[1] || 'Units' };
      });
      await fetch('/api/inventory/quick-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, location_id: locFilter }),
      });
      setCounts({});
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      console.error('Quick count submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
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
            <span className="text-[var(--fs-base)] font-semibold text-green-700">Quick counts submitted for review</span>
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
              return (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{catName}</div>
                  </div>
                  <Stepper value={val} uom={uom}
                    onMinus={() => stepQty(p.id, -1)}
                    onPlus={() => stepQty(p.id, 1)}
                    onTap={() => openNumpad(p)} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submit bar */}
      {countedN > 0 && (
        <div className="px-4 py-3">
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
            {submitting ? 'Submitting...' : `Submit ${countedN} quick count${countedN !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Scan FAB */}
      <button
        onClick={() => setShowScanner(true)}
        className="fixed bottom-28 right-5 z-[30] w-14 h-14 rounded-full bg-[#2563EB] text-white shadow-lg shadow-blue-600/40 flex items-center justify-center active:scale-95 active:bg-blue-700 transition-transform"
        aria-label="Scan barcode"
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

      {/* Barcode scanner overlay — persistent, never unmounts */}
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
        pendingBarcode={hwBarcode}
        onPendingConsumed={() => setHwBarcode(undefined)}
      />

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
    </div>
  );
}
