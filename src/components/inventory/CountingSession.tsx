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
  const [session, setSession] = useState&lt;any>(null);
  const [products, setProducts] = useState&lt;any[]>([]);
  const [entries, setEntries] = useState&lt;Record&lt;number, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [numpad, setNumpad] = useState&lt;{ open: boolean; product: any | null }>({ open: false, product: null });
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState&lt;View>('counting');
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

      const entryMap: Record&lt;number, number> = {};
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
        const seen = new Set&lt;number>();
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
    const cats = new Map&lt;number, string>();
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
      await fetch(`/api/inventory/counts?session_id=${sessionId}&amp;product_id=${productId}`, { method: 'DELETE' });
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

  if (loading) return &lt;div className="min-h-screen bg-gray-50">&lt;Spinner />&lt;/div>;

  const canSubmit = session?.status === 'pending' || session?.status === 'in_progress';
  const isReadOnly = session?.status === 'submitted' || session?.status === 'approved' || session?.status === 'rejected';
  const locationName = session?.location_name || '';

  // ── REVIEW SCREEN ──
  if (view === 'review') {
    return (
      &lt;div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        &lt;div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          &lt;div className="flex items-center justify-between mb-1">
            &lt;button onClick={() => setView('counting')} className="flex items-center gap-1 text-green-700 text-[13px] font-semibold active:opacity-70">
              &lt;svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>&lt;path d="M15 19l-7-7 7-7"/>&lt;/svg>
              Edit counts
            &lt;/button>
          &lt;/div>
          &lt;h1 className="text-[18px] font-bold text-[#1F2933]">Review count&lt;/h1>
          &lt;p className="text-[12px] text-gray-500 mt-0.5">{session?.template_name} &amp;middot; {session?.scheduled_date}&lt;/p>
        &lt;/div>

        {/* Summary card */}
        &lt;div className="px-4 pt-4">
          &lt;div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
            &lt;div className="flex items-center justify-between mb-3">
              &lt;span className="text-[13px] font-bold text-[#1F2933]">Count summary&lt;/span>
              &lt;span className="text-[12px] font-mono text-gray-500">{countedCount}/{totalCount}&lt;/span>
            &lt;/div>
            &lt;div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              &lt;div className={`h-full rounded-full transition-all ${countedCount === totalCount ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${totalCount > 0 ? (countedCount / totalCount) * 100 : 0}%` }} />
            &lt;/div>
            &lt;div className="flex gap-3">
              &lt;div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                &lt;div className="text-[20px] font-bold text-green-700 font-mono">{countedCount}&lt;/div>
                &lt;div className="text-[11px] text-green-600 font-semibold">Counted&lt;/div>
              &lt;/div>
              &lt;div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                &lt;div className="text-[20px] font-bold text-amber-700 font-mono">{uncountedProducts.length}&lt;/div>
                &lt;div className="text-[11px] text-amber-600 font-semibold">Uncounted&lt;/div>
              &lt;/div>
            &lt;/div>
          &lt;/div>

          {/* Uncounted warning */}
          {uncountedProducts.length > 0 && (
            &lt;div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-3">
              &lt;div className="flex items-start gap-2.5">
                &lt;span className="text-amber-600 text-[16px] mt-0.5">&#x26A0;&lt;/span>
                &lt;div>
                  &lt;p className="text-[13px] font-semibold text-amber-800">
                    {uncountedProducts.length} item{uncountedProducts.length > 1 ? 's' : ''} not counted
                  &lt;/p>
                  &lt;p className="text-[11px] text-amber-700 mt-0.5">
                    Uncounted items will be submitted as "not counted". You can go back and count them.
                  &lt;/p>
                &lt;/div>
              &lt;/div>
            &lt;/div>
          )}
        &lt;/div>

        {/* Counted items list */}
        &lt;div className="flex-1 overflow-y-auto px-4 pb-28">
          {countedProducts.length > 0 && (
            &lt;>
              &lt;p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items&lt;/p>
              {countedProducts.map((p) => {
                const val = entries[p.id];
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  &lt;div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                    &lt;div className="flex items-center gap-2 flex-1 min-w-0">
                      &lt;div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        &lt;svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round">&lt;path d="M20 6L9 17l-5-5"/>&lt;/svg>
                      &lt;/div>
                      &lt;span className="text-[13px] text-gray-900 truncate">{p.name}&lt;/span>
                    &lt;/div>
                    &lt;span className="text-[14px] font-mono font-semibold text-[#1F2933] flex-shrink-0 ml-3">
                      {val} &lt;span className="text-[11px] text-gray-400 font-normal">{uom}&lt;/span>
                    &lt;/span>
                  &lt;/div>
                );
              })}
            &lt;/>
          )}

          {uncountedProducts.length > 0 && (
            &lt;>
              &lt;p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted&lt;/p>
              {uncountedProducts.map((p) => {
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  &lt;div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                    &lt;div className="flex items-center gap-2 flex-1 min-w-0">
                      &lt;div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        &lt;span className="text-gray-400 text-[10px] font-bold">--&lt;/span>
                      &lt;/div>
                      &lt;span className="text-[13px] text-gray-500 truncate">{p.name}&lt;/span>
                    &lt;/div>
                    &lt;span className="text-[12px] text-gray-400 flex-shrink-0 ml-3">-- {uom}&lt;/span>
                  &lt;/div>
                );
              })}
            &lt;/>
          )}
        &lt;/div>

        {/* Submit bar */}
        {canSubmit && (
          &lt;div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
            &lt;button onClick={() => setShowConfirm(true)} disabled={submitting || countedCount === 0}
              className="w-full py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
              Submit for approval
            &lt;/button>
          &lt;/div>
        )}

        {/* Confirmation overlay */}
        {showConfirm && (
          &lt;div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center">
            &lt;div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8 animate-slide-up">
              &lt;h3 className="text-[17px] font-bold text-[#1F2933] mb-2">Submit this count?&lt;/h3>
              &lt;p className="text-[13px] text-gray-500 mb-1">
                {countedCount} of {totalCount} items counted.
                {uncountedProducts.length > 0 && ` ${uncountedProducts.length} item${uncountedProducts.length > 1 ? 's' : ''} will be marked as not counted.`}
              &lt;/p>
              &lt;p className="text-[13px] text-gray-500 mb-5">
                You will not be able to edit after submitting. A manager will review your count.
              &lt;/p>
              &lt;div className="flex gap-3">
                &lt;button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[14px] font-semibold active:bg-gray-200">
                  Cancel
                &lt;/button>
                &lt;button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Yes, submit'}
                &lt;/button>
              &lt;/div>
            &lt;/div>
          &lt;/div>
        )}
      &lt;/div>
    );
  }

  // ── COUNTING SCREEN ──
  return (
    &lt;div className="min-h-screen bg-gray-50 flex flex-col">
      &lt;BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${session?.scheduled_date || ''} ${locationName ? '\u00B7 ' + locationName : ''} \u00B7 ${totalCount} products`}
      />

      &lt;SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      &lt;FilterBar>
        &lt;FilterPill active={statusFilter === 'all'} label="All" count={totalCount} onClick={() => setStatusFilter('all')} />
        &lt;FilterPill active={statusFilter === 'uncounted'} label="Uncounted" count={totalCount - countedCount} onClick={() => setStatusFilter('uncounted')} />
        &lt;FilterPill active={statusFilter === 'counted'} label="Counted" count={countedCount} onClick={() => setStatusFilter('counted')} />
      &lt;/FilterBar>

      {categories.length > 1 && (
        &lt;FilterBar>
          &lt;FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            &lt;FilterPill key={c.id} active={catFilter === String(c.id)} label={c.name} onClick={() => setCatFilter(String(c.id))} />
          ))}
        &lt;/FilterBar>
      )}

      &lt;CountProgress counted={countedCount} total={totalCount} />

      &lt;div className="flex-1 overflow-y-auto px-4 pb-28">
        {totalCount === 0 ? (
          &lt;EmptyState title="No products configured" body="This counting list has no products. Ask your manager to edit the template." />
        ) : filtered.length === 0 ? (
          &lt;EmptyState title="No products match" body="Try a different filter or search term" />
        ) : (
          &lt;div className="flex flex-col">
            {filtered.map((p) => {
              const val = entries[p.id] ?? null;
              const uom = p.uom_id?.[1] || 'Units';
              const catName = p.categ_id?.[1] || '';
              return (
                &lt;div key={p.id} className="flex items-center gap-3 py-3 border-b border-gray-100">
                  &lt;div className="flex-1 min-w-0">
                    &lt;div className="text-[14px] font-semibold text-gray-900 truncate">{p.name}&lt;/div>
                    &lt;div className="text-[11px] text-gray-400 mt-0.5">{catName} {uom !== 'Units' ? `\u00B7 ${uom}` : ''}&lt;/div>
                  &lt;/div>
                  {!isReadOnly ? (
                    &lt;Stepper value={val} uom={uom}
                      onMinus={() => stepQty(p, -1)}
                      onPlus={() => stepQty(p, 1)}
                      onTap={() => openNumpad(p)} />
                  ) : (
                    &lt;div className="text-[15px] font-mono font-semibold text-gray-700">
                      {val !== null ? val : '--'} &lt;span className="text-[11px] text-gray-400">{uom}&lt;/span>
                    &lt;/div>
                  )}
                &lt;/div>
              );
            })}
          &lt;/div>
        )}
      &lt;/div>

      {/* Review button */}
      {canSubmit && countedCount > 0 && (
        &lt;div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
          &lt;button onClick={() => setView('review')}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Review count ({countedCount}/{totalCount})
          &lt;/button>
        &lt;/div>
      )}

      {/* Read-only notice */}
      {isReadOnly && (
        &lt;div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-gray-100 border-t border-gray-200 z-40">
          &lt;p className="text-center text-[13px] text-gray-500 font-semibold">
            {session?.status === 'submitted' ? 'Submitted \u2014 awaiting review' : session?.status === 'approved' ? 'Approved' : 'Rejected'}
          &lt;/p>
        &lt;/div>
      )}

      {/* Numpad */}
      {!isReadOnly && (
        &lt;NumpadModal
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
    &lt;/div>
  );
}
