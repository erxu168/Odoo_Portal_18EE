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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Step 1: fetch session list and count entries
      const [sessRes, countRes] = await Promise.all([
        fetch('/api/inventory/sessions').then((r) => r.json()),
        fetch(`/api/inventory/counts?session_id=${sessionId}`).then((r) => r.json()),
      ]);

      // Find this session
      const sess = (sessRes.sessions || []).find((s: any) => s.id === sessionId);
      setSession(sess);

      // Map entries by product_id
      const entryMap: Record<number, number> = {};
      for (const e of (countRes.entries || [])) {
        entryMap[e.product_id] = e.counted_qty;
      }
      setEntries(entryMap);

      // Step 2: load products from template's product_ids or category_ids
      let productIds: number[] = [];
      let categoryIds: number[] = [];
      try {
        productIds = JSON.parse(sess?.template_product_ids || '[]');
      } catch { productIds = []; }
      try {
        categoryIds = JSON.parse(sess?.template_category_ids || '[]');
      } catch { categoryIds = []; }

      let loadedProducts: any[] = [];

      if (productIds.length > 0) {
        // Fetch specific products by ID
        const prodRes = await fetch(`/api/inventory/products?ids=${productIds.join(',')}`).then(r => r.json());
        loadedProducts = prodRes.products || [];
      } else if (categoryIds.length > 0) {
        // Fetch products by categories
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

  // Derive categories from product list
  const categories = React.useMemo(() => {
    const cats = new Map<number, string>();
    products.forEach((p) => { if (p.categ_id) cats.set(p.categ_id[0], p.categ_id[1]); });
    return Array.from(cats.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  // Filter products
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
    if (!confirm('Submit this count? You will not be able to edit after submitting.')) return;
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
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><Spinner /></div>;

  const canSubmit = session?.status === 'pending' || session?.status === 'in_progress';
  const isReadOnly = session?.status === 'submitted' || session?.status === 'approved' || session?.status === 'rejected';
  const locationName = session?.location_name || '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${session?.scheduled_date || ''} ${locationName ? '\u00B7 ' + locationName : ''} \u00B7 ${totalCount} products`}
      />

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      {/* Status pills */}
      <FilterBar>
        <FilterPill active={statusFilter === 'all'} label="All" count={totalCount} onClick={() => setStatusFilter('all')} />
        <FilterPill active={statusFilter === 'uncounted'} label="Uncounted" count={totalCount - countedCount} onClick={() => setStatusFilter('uncounted')} />
        <FilterPill active={statusFilter === 'counted'} label="Counted" count={countedCount} onClick={() => setStatusFilter('counted')} />
      </FilterBar>

      {/* Category pills */}
      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === String(c.id)} label={c.name} onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>
      )}

      <CountProgress counted={countedCount} total={totalCount} />

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 pb-28">
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

      {/* Submit bar */}
      {canSubmit && countedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
            {submitting ? 'Submitting...' : `Submit count (${countedCount}/${totalCount} items)`}
          </button>
        </div>
      )}

      {/* Read-only notice */}
      {isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-gray-100 border-t border-gray-200 z-40">
          <p className="text-center text-[13px] text-gray-500 font-semibold">
            {session?.status === 'submitted' ? 'Submitted \u2014 awaiting review' : session?.status === 'approved' ? 'Approved' : 'Rejected'}
          </p>
        </div>
      )}

      {/* Numpad */}
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
