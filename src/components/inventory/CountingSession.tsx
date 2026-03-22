'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BackHeader, FilterBar, FilterPill, SearchBar, CountProgress, Stepper, Spinner, EmptyState } from './ui';
import NumpadModal from './NumpadModal';

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [numpad, setNumpad] = useState<{ open: boolean; product: any | null }>({ open: false, product: null });
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<View>('counting');
  const [showConfirm, setShowConfirm] = useState(false);

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

  const categories = React.useMemo(() => {
    const cats = new Map<number, string>();
    products.forEach((p) => { if (p.categ_id) cats.set(p.categ_id[0], p.categ_id[1]); });
    return Array.from(cats.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = [...products];
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') list = list.filter((p) => p.categ_id?.[0] === Number(catFilter));
    if (statusFilter === 'counted') list = list.filter((p) => entries[p.id] !== undefined);
    if (statusFilter === 'uncounted') list = list.filter((p) => entries[p.id] === undefined);
    return list;
  }, [products, search, catFilter, statusFilter, entries]);

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

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await fetch('/api/inventory/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'submitted' }),
      });
      onSubmit();
    } catch (err) {
      console.error('Submit failed:', err);
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><Spinner /></div>;

  const canSubmit = session?.status === 'pending' || session?.status === 'in_progress';
  const isReadOnly = session?.status === 'submitted' || session?.status === 'approved' || session?.status === 'rejected';
  const locationName = session?.location_name || '';

  if (view === 'review') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => setView('counting')} className="flex items-center gap-1 text-green-700 text-[13px] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Edit counts
            </button>
          </div>
          <h1 className="text-[18px] font-bold text-[#1F2933]">Review count</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">{session?.template_name} {'\u00B7'} {session?.scheduled_date}</p>
        </div>

        <div className="px-4 pt-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-bold text-[#1F2933]">Count summary</span>
              <span className="text-[12px] font-mono text-gray-500">{countedCount}/{totalCount}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all ${countedCount === totalCount ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${totalCount > 0 ? (countedCount / totalCount) * 100 : 0}%` }} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                <div className="text-[20px] font-bold text-green-700 font-mono">{countedCount}</div>
                <div className="text-[11px] text-green-600 font-semibold">Counted</div>
              </div>
              <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-[20px] font-bold text-amber-700 font-mono">{uncountedProducts.length}</div>
                <div className="text-[11px] text-amber-600 font-semibold">Uncounted</div>
              </div>
            </div>
          </div>

          {uncountedProducts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-3">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-600 text-[16px] mt-0.5">{'\u26A0'}</span>
                <div>
                  <p className="text-[13px] font-semibold text-amber-800">
                    {uncountedProducts.length} item{uncountedProducts.length > 1 ? 's' : ''} not counted
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Uncounted items will be submitted as not counted. You can go back and count them.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-36">
          {countedProducts.length > 0 && (
            <>
              <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items</p>
              {countedProducts.map((p) => {
                const val = entries[p.id];
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </div>
                      <span className="text-[13px] text-gray-900 truncate">{p.name}</span>
                    </div>
                    <span className="text-[14px] font-mono font-semibold text-[#1F2933] flex-shrink-0 ml-3">
                      {val} <span className="text-[11px] text-gray-400 font-normal">{uom}</span>
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {uncountedProducts.length > 0 && (
            <>
              <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted</p>
              {uncountedProducts.map((p) => {
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-gray-400 text-[10px] font-bold">--</span>
                      </div>
                      <span className="text-[13px] text-gray-500 truncate">{p.name}</span>
                    </div>
                    <span className="text-[12px] text-gray-400 flex-shrink-0 ml-3">-- {uom}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {canSubmit && (
          <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
            <button onClick={() => setShowConfirm(true)} disabled={submitting || countedCount === 0}
              className="w-full py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
              Submit for approval
            </button>
          </div>
        )}

        {showConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
            <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
              <h3 className="text-[17px] font-bold text-[#1F2933] mb-2">Submit this count?</h3>
              <p className="text-[13px] text-gray-500 mb-1">
                {countedCount} of {totalCount} items counted.
                {uncountedProducts.length > 0 && ` ${uncountedProducts.length} item${uncountedProducts.length > 1 ? 's' : ''} will be marked as not counted.`}
              </p>
              <p className="text-[13px] text-gray-500 mb-5">
                You will not be able to edit after submitting. A manager will review your count.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[14px] font-semibold active:bg-gray-200">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Yes, submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${session?.scheduled_date || ''} ${locationName ? '\u00B7 ' + locationName : ''} \u00B7 ${totalCount} products`}
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
            <FilterPill key={c.id} active={catFilter === String(c.id)} label={c.name} onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>
      )}

      <CountProgress counted={countedCount} total={totalCount} />

      <div className="flex-1 overflow-y-auto px-4 pb-36">
        {totalCount === 0 ? (
          <EmptyState title="No products configured" body="This counting list has no products. Ask your manager to edit the template." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products match" body="Try a different filter or search term" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p) => {
              const val = entries[p.id] ?? null;
              const uom = p.uom_id?.[1] || 'Units';
              const catName = p.categ_id?.[1] || '';
              return (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{catName} {uom !== 'Units' ? `\u00B7 ${uom}` : ''}</div>
                  </div>
                  {!isReadOnly ? (
                    <Stepper value={val} uom={uom}
                      onMinus={() => stepQty(p, -1)}
                      onPlus={() => stepQty(p, 1)}
                      onTap={() => openNumpad(p)} />
                  ) : (
                    <div className="text-[15px] font-mono font-semibold text-gray-700">
                      {val !== null ? val : '--'} <span className="text-[11px] text-gray-400">{uom}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canSubmit && countedCount > 0 && (
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
          <button onClick={() => setView('review')}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Review count ({countedCount}/{totalCount})
          </button>
        </div>
      )}

      {isReadOnly && (
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-gray-100 border-t border-gray-200 z-40">
          <p className="text-center text-[13px] text-gray-500 font-semibold">
            {session?.status === 'submitted' ? 'Submitted \u2014 awaiting review' : session?.status === 'approved' ? 'Approved' : 'Rejected'}
          </p>
        </div>
      )}

      {!isReadOnly && (
        <NumpadModal
          open={numpad.open}
          productName={numpad.product?.name || ''}
          category={numpad.product?.categ_id?.[1] || ''}
          uom={numpad.product?.uom_id?.[1] || 'Units'}
          initialValue={numpad.product ? (entries[numpad.product.id] ?? null) : null}
          showSystemQty={userRole !== 'staff'}
          systemQty={null}
          locationName={locationName}
          onSave={handleNumpadSave}
          onClose={() => setNumpad({ open: false, product: null })}
        />
      )}
    </div>
  );
}
