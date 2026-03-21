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
      const [sessRes, countRes, prodRes] = await Promise.all([
        fetch(`/api/inventory/sessions?status=&template_id=`).then((r) => r.json()),
        fetch(`/api/inventory/counts?session_id=${sessionId}`).then((r) => r.json()),
        fetch('/api/inventory/products').then((r) => r.json()),
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

      // TODO: filter products by template categories
      setProducts(prodRes.products || []);
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
  const locationName = session?.location_name || '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${session?.scheduled_date || ''} \u00B7 ${locationName} \u00B7 ${totalCount} products`}
        right={canSubmit && countedCount > 0 ? (
          <button onClick={handleSubmit} disabled={submitting}
            className="text-green-700 text-[13px] font-semibold active:opacity-70">
            Review
          </button>
        ) : undefined}
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
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
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
                    <div className="text-[11px] text-gray-400 mt-0.5">{catName}</div>
                  </div>
                  <Stepper value={val} uom={uom}
                    onMinus={() => stepQty(p, -1)}
                    onPlus={() => stepQty(p, 1)}
                    onTap={() => openNumpad(p)} />
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
            {submitting ? 'Submitting...' : `Review & submit (${countedCount} items)`}
          </button>
        </div>
      )}

      {/* Numpad */}
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
    </div>
  );
}
