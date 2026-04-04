'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BackHeader, FilterBar, FilterPill, SearchBar, CountProgress, Stepper, Spinner, EmptyState, leafCategory } from './ui';
import NumpadModal from './NumpadModal';
import FilePicker from "@/components/ui/FilePicker";
import BarcodeScanner from '@/components/ui/BarcodeScanner';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';

interface CountingSessionProps {
  sessionId: number;
  userRole: string;
  onBack: () => void;
  onSubmit: () => void;
}

type View = 'counting' | 'review';

export default function CountingSession({ sessionId, userRole, onBack, onSubmit }: CountingSessionProps) {
  const [session, setSession] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [entries, setEntries] = useState<Record<number, number>>({});
  const [systemQtys, setSystemQtys] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [numpad, setNumpad] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<View>('counting');
  const [showConfirm, setShowConfirm] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // -- Barcode scanner --
  const [showScanner, setShowScanner] = useState(false);

  function handleHardwareScan(barcode: string) {
    const product = products.find((p: any) => p.barcode && p.barcode === barcode);
    if (product) {
      setSearch('');
      setCatFilter('all');
      setStatusFilter('all');
      openNumpad(product);
    }
  }

  useHardwareScanner({
    enabled: view === 'counting' && !numpad.open && !showScanner && !showConfirm && !loading,
    onScan: handleHardwareScan,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, countRes] = await Promise.all([
        fetch('/api/inventory/sessions').then((r) => r.json()),
        fetch(`/api/inventory/counts?session_id=${sessionId}`).then((r) => r.json()),
      ]);

      const sess = (sessRes.sessions || []).find((s: any) => s.id === sessionId);
      setSession(sess);

      const entryMap: Record<number, number> = {};
      for (const e of (countRes.entries || [])) {
        entryMap[e.product_id] = e.counted_qty;
      }
      setEntries(entryMap);
      setSystemQtys(countRes.system_qtys || {});

      let productIds: number[] = [];
      let categoryIds: number[] = [];
      try { productIds = JSON.parse(sess?.template_product_ids || '[]'); } catch { productIds = []; }
      try { categoryIds = JSON.parse(sess?.template_category_ids || '[]'); } catch { categoryIds = []; }

      let loadedProducts: any[] = [];

      if (productIds.length > 0) {
        const prodRes = await fetch(`/api/inventory/products?ids=${productIds.join(',')}`).then(r => r.json());
        loadedProducts = prodRes.products || [];
      } else if (categoryIds.length > 0) {
        const promises = categoryIds.map(cid =>
          fetch(`/api/inventory/products?category_id=${cid}`).then(r => r.json())
        );
        const results = await Promise.all(promises);
        const seen = new Set<number>();
        results.forEach(r => {
          (r.products || []).forEach((p: any) => {
            if (!seen.has(p.id)) { seen.add(p.id); loadedProducts.push(p); }
          });
        });
      }

      setProducts(loadedProducts);
    } catch (err) {
      console.error('Failed to load session:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build categories using LEAF names only
  const categories = React.useMemo(() => {
    const cats = new Map<string, { id: number; leaf: string }>();
    products.forEach((p) => {
      if (p.categ_id) {
        const leaf = leafCategory(p.categ_id[1]);
        if (!cats.has(leaf)) cats.set(leaf, { id: p.categ_id[0], leaf });
      }
    });
    return Array.from(cats.values());
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = [...products];
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') {
      list = list.filter((p) => {
        const leaf = leafCategory(p.categ_id?.[1] || '');
        return leaf === catFilter;
      });
    }
    if (statusFilter === 'counted') list = list.filter((p) => entries[p.id] !== undefined);
    if (statusFilter === 'uncounted') list = list.filter((p) => entries[p.id] === undefined);
    return list;
  }, [products, search, catFilter, statusFilter, entries]);

  // Group filtered products by leaf category
  const grouped = React.useMemo(() => {
    const groups: { catName: string; items: any[] }[] = [];
    const catMap = new Map<string, any[]>();
    const catOrder: string[] = [];

    for (const p of filtered) {
      const cat = leafCategory(p.categ_id?.[1] || 'Other');
      if (!catMap.has(cat)) {
        catMap.set(cat, []);
        catOrder.push(cat);
      }
      catMap.get(cat)!.push(p);
    }

    for (const catName of catOrder) {
      groups.push({ catName, items: catMap.get(catName)! });
    }

    return groups;
  }, [filtered]);

  const countedCount = Object.keys(entries).length;
  const totalCount = products.length;
  const uncountedProducts = products.filter(p => entries[p.id] === undefined);
  const countedProducts = products.filter(p => entries[p.id] !== undefined);

  async function saveCount(productId: number, qty: number | null, uom: string) {
    if (qty === null || qty === undefined) {
      await fetch(`/api/inventory/counts?session_id=${sessionId}&product_id=${productId}`, { method: 'DELETE' });
      setEntries((prev) => { const next = { ...prev }; delete next[productId]; return next; });
    } else {
      await fetch('/api/inventory/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, product_id: productId, counted_qty: qty, uom }),
      });
      setEntries((prev) => ({ ...prev, [productId]: qty }));
    }
  }

  function handleScanCount(productId: number, qty: number, uom: string) {
    saveCount(productId, qty, uom);
  }

  function stepQty(product: any, delta: number) {
    const current = entries[product.id];
    const val = current !== undefined ? current : 0;
    const next = Math.max(0, val + delta);
    if (next === 0 && (current === undefined || current === 0) && delta < 0) return;
    saveCount(product.id, next, product.uom_id?.[1] || 'Units');
  }

  function openNumpad(product: any) {
    setNumpad({ open: true, product });
  }

  function handleNumpadSave(value: number | null) {
    if (numpad.product) {
      saveCount(numpad.product.id, value, numpad.product.uom_id?.[1] || 'Units');
    }
    setNumpad({ open: false, product: null });
  }

  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 800;
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        setProofPhoto(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/inventory/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'submitted', proof_photo: proofPhoto }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Submit failed.');
        setShowConfirm(false);
        return;
      }
      onSubmit();
    } catch (err) {
      console.error('Submit failed:', err);
      setSubmitError('Connection failed. Please try again.');
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><Spinner /></div>;

  const canSubmit = session?.status === 'pending' || session?.status === 'in_progress';
  const isReadOnly = session?.status === 'submitted' || session?.status === 'approved' || session?.status === 'rejected';
  const locationName = session?.location_name || '';
  const showCatGroups = categories.length > 1 && catFilter === 'all' && !search;

  // -- Scan FAB --
  const scanFab = !isReadOnly && (
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
  );

  // ============================
  // REVIEW VIEW
  // ============================
  if (view === 'review') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => setView('counting')} className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Edit counts
            </button>
          </div>
          <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Review count</h1>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-0.5">{session?.template_name} {'\u00B7'} {session?.scheduled_date}</p>
        </div>

        <div className="px-4 pt-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[var(--fs-lg)] font-bold text-gray-900">Count summary</span>
              <span className="text-[var(--fs-sm)] font-mono text-gray-500">{countedCount}/{totalCount}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all ${countedCount === totalCount ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${totalCount > 0 ? (countedCount / totalCount) * 100 : 0}%` }} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                <div className="text-[var(--fs-xxl)] font-bold text-green-700 font-mono">{countedCount}</div>
                <div className="text-[var(--fs-xs)] text-green-600 font-semibold">Counted</div>
              </div>
              <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-[var(--fs-xxl)] font-bold text-amber-700 font-mono">{uncountedProducts.length}</div>
                <div className="text-[var(--fs-xs)] text-amber-600 font-semibold">Uncounted</div>
              </div>
            </div>
          </div>

          {uncountedProducts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-3">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-600 mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </span>
                <div>
                  <p className="text-[var(--fs-base)] font-semibold text-amber-800">
                    {uncountedProducts.length} item{uncountedProducts.length > 1 ? 's' : ''} not counted
                  </p>
                  <p className="text-[var(--fs-xs)] text-amber-700 mt-0.5">
                    Uncounted items will be submitted as not counted. You can go back and count them.
                  </p>
                </div>
              </div>
            </div>
          )}

          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-3">
              <p className="text-[var(--fs-base)] font-semibold text-red-700">{submitError}</p>
            </div>
          )}

          {canSubmit && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">Proof photo</p>
              {proofPhoto ? (
                <div className="relative">
                  <img src={proofPhoto} alt="Proof" className="w-full rounded-xl border border-gray-200" />
                  <button onClick={() => setProofPhoto('')}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center active:bg-black/70">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ) : (
                <FilePicker
                  onFile={(file) => handlePhotoCapture({ target: { files: [file] } } as any)}
                  accept="image/*"
                  label="Take a photo of the shelf"
                  className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 text-[var(--fs-base)] font-semibold flex items-center justify-center gap-2 active:bg-gray-50"
                />
              )}
              <p className="text-[var(--fs-xs)] text-gray-400 mt-2">Photo proof is required for submission.</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-36">
          {countedProducts.length > 0 && (
            <>
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items</p>
              {countedProducts.map((p) => {
                const val = entries[p.id];
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </div>
                      <span className="text-[var(--fs-lg)] text-gray-900 truncate">{p.name}</span>
                    </div>
                    <span className="text-[var(--fs-lg)] font-mono font-semibold text-gray-900 flex-shrink-0 ml-3">
                      {val} <span className="text-[var(--fs-xs)] text-gray-400 font-normal">{uom}</span>
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {uncountedProducts.length > 0 && (
            <>
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted</p>
              {uncountedProducts.map((p) => {
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-gray-400 text-[var(--fs-xs)] font-bold">--</span>
                      </div>
                      <span className="text-[var(--fs-lg)] text-gray-500 truncate">{p.name}</span>
                    </div>
                    <span className="text-[var(--fs-sm)] text-gray-400 flex-shrink-0 ml-3">-- {uom}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {canSubmit && (
          <div className="px-4 py-3">
            <button onClick={() => setShowConfirm(true)} disabled={submitting || countedCount === 0}
              className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
              Submit for approval
            </button>
          </div>
        )}

        {showConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
            <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
              <h3 className="text-[var(--fs-xl)] font-bold text-gray-900 mb-2">Submit this count?</h3>
              <p className="text-[var(--fs-base)] text-gray-500 mb-1">
                {countedCount} of {totalCount} items counted.
                {uncountedProducts.length > 0 && ` ${uncountedProducts.length} item${uncountedProducts.length > 1 ? 's' : ''} will be marked as not counted.`}
              </p>
              <p className="text-[var(--fs-base)] text-gray-500 mb-5">
                You will not be able to edit after submitting. A manager will review your count.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[var(--fs-sm)] font-bold active:bg-gray-200">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Yes, submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================
  // COUNTING VIEW
  // ============================
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${locationName ? locationName + ' \u00B7 ' : ''}${totalCount} products`}
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <FilterBar>
        <FilterPill active={statusFilter === 'all'} label="All" count={totalCount} onClick={() => setStatusFilter('all')} />
        <FilterPill active={statusFilter === 'uncounted'} label="Uncounted" count={totalCount - countedCount} onClick={() => setStatusFilter('uncounted')} />
        <FilterPill active={statusFilter === 'counted'} label="Counted" count={countedCount} onClick={() => setStatusFilter('counted')} />
      </FilterBar>

      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === c.leaf} label={c.leaf} onClick={() => setCatFilter(c.leaf)} />
          ))}
        </FilterBar>
      )}

      <CountProgress counted={countedCount} total={totalCount} />

      <div className="flex-1 overflow-y-auto px-4 pb-36">
        {totalCount === 0 ? (
          <EmptyState title="No products configured" body="This counting list has no products. Ask your manager to edit the template." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products match" body="Try a different filter or search term" />
        ) : showCatGroups ? (
          /* Grouped by category */
          <div className="flex flex-col">
            {grouped.map((group) => (
              <div key={group.catName}>
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 pt-4 pb-2">
                  {group.catName}
                </div>
                {group.items.map((p) => {
                  const val = entries[p.id] ?? null;
                  const uom = p.uom_id?.[1] || 'Units';
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-lg)] font-semibold text-gray-900 truncate">{p.name}</div>
                        {uom !== 'Units' && (
                          <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{uom}</div>
                        )}
                      </div>
                      {!isReadOnly ? (
                        <Stepper value={val} uom={uom}
                          onMinus={() => stepQty(p, -1)}
                          onPlus={() => stepQty(p, 1)}
                          onTap={() => openNumpad(p)} />
                      ) : (
                        <div className="text-[var(--fs-lg)] font-mono font-semibold text-gray-700">
                          {val !== null ? val : '--'} <span className="text-[var(--fs-xs)] text-gray-400">{uom}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          /* Flat list (when filtered by category or searching) */
          <div className="flex flex-col">
            {filtered.map((p) => {
              const val = entries[p.id] ?? null;
              const uom = p.uom_id?.[1] || 'Units';
              const catName = leafCategory(p.categ_id?.[1] || '');
              return (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-lg)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{catName}{uom !== 'Units' ? ` \u00B7 ${uom}` : ''}</div>
                  </div>
                  {!isReadOnly ? (
                    <Stepper value={val} uom={uom}
                      onMinus={() => stepQty(p, -1)}
                      onPlus={() => stepQty(p, 1)}
                      onTap={() => openNumpad(p)} />
                  ) : (
                    <div className="text-[var(--fs-lg)] font-mono font-semibold text-gray-700">
                      {val !== null ? val : '--'} <span className="text-[var(--fs-xs)] text-gray-400">{uom}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canSubmit && countedCount > 0 && (
        <div className="px-4 py-3">
          <button onClick={() => setView('review')}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Review count ({countedCount}/{totalCount})
          </button>
        </div>
      )}

      {isReadOnly && (
        <div className="px-4 py-3 bg-gray-100 rounded-xl">
          <p className="text-center text-[var(--fs-base)] text-gray-500 font-semibold">
            {session?.status === 'submitted' ? 'Submitted \u2014 awaiting review' : session?.status === 'approved' ? 'Approved' : 'Rejected'}
          </p>
        </div>
      )}

      {scanFab}

      <BarcodeScanner
        open={showScanner}
        onClose={() => setShowScanner(false)}
        products={products}
        entries={entries}
        totalCount={totalCount}
        countedCount={countedCount}
        onCount={handleScanCount}
        userRole={userRole}
        title="Scan product"
      />

      {!isReadOnly && (
        <NumpadModal
          open={numpad.open}
          productName={numpad.product?.name || ''}
          category={numpad.product?.categ_id?.[1] || ''}
          uom={numpad.product?.uom_id?.[1] || 'Units'}
          initialValue={numpad.product ? (entries[numpad.product.id] ?? null) : null}
          showSystemQty={userRole !== 'staff'}
          systemQty={numpad.product ? (systemQtys[numpad.product.id] ?? null) : null}
          locationName={locationName}
          onSave={handleNumpadSave}
          onClose={() => setNumpad({ open: false, product: null })}
        />
      )}
    </div>
  );
}
