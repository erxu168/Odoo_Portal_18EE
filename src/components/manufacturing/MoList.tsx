'use client';

import React, { useState, useEffect, useMemo } from 'react';

interface MoListProps {
  onSelect: (moId: number) => void;
  onCreate: () => void;
}

export default function MoList({ onSelect, onCreate }: MoListProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // BUG FIX #5: Default to 'all' so test data (drafts) is visible
  const [filter, setFilter] = useState('all');

  useEffect(() => { fetchOrders(); }, []);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch('/api/manufacturing-orders?limit=100');
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      console.error('Failed to fetch MOs:', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'active') return orders.filter((m) => m.state === 'confirmed' || m.state === 'progress');
    return orders.filter((m) => m.state === filter);
  }, [orders, filter]);

  const stateColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    confirmed: 'bg-indigo-50 text-indigo-700',
    progress: 'bg-amber-50 text-amber-700',
    done: 'bg-emerald-50 text-emerald-700',
    cancel: 'bg-red-50 text-red-700',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress', done: 'Done', cancel: 'Cancelled',
  };

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'progress', label: 'In Progress' },
    { id: 'confirmed', label: 'To Do' },
    { id: 'done', label: 'Done' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Manufacturing</h1>
        <p className="text-xs text-gray-500 mt-0.5">SSAM Korean BBQ</p>
      </div>

      {/* Segment filter */}
      <div className="px-4 py-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide transition-all ${
                filter === f.id
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* MO Cards */}
      <div className="px-4 pb-24 flex flex-col gap-2.5">
        {filtered.map((mo) => {
          const pct = mo.product_qty > 0 ? Math.round((mo.qty_producing / mo.product_qty) * 100) : 0;
          const woCount = mo.work_order_count || 0;
          const compCount = mo.move_raw_ids?.length || 0;
          const uom = mo.product_uom_id?.[1] || 'kg';
          const deadline = mo.date_deadline
            ? new Date(mo.date_deadline).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '';

          return (
            <button
              key={mo.id}
              onClick={() => onSelect(mo.id)}
              className="bg-white border border-gray-200 rounded-xl p-4 text-left active:bg-gray-50 transition-colors"
            >
              {/* Top row */}
              <div className="flex justify-between items-start mb-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 font-semibold tracking-wider">{mo.name}</span>
                  </div>
                  <div className="text-[15px] font-bold text-gray-900 mt-1 leading-tight">{mo.product_id[1]}</div>
                </div>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold flex-shrink-0 ${stateColors[mo.state] || 'bg-gray-100 text-gray-600'}`}>
                  {stateLabels[mo.state] || mo.state}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex gap-4 text-xs text-gray-500 mb-2.5">
                <span>Qty: <strong className="text-gray-900">{mo.qty_producing}/{mo.product_qty}</strong> {uom}</span>
                {woCount > 0 && <span>WOs: <strong className="text-gray-900">{woCount}</strong></span>}
                {compCount > 0 && <span>Comps: <strong className="text-gray-900">{compCount}</strong></span>}
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    mo.state === 'done' ? 'bg-emerald-500' : mo.state === 'progress' ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Bottom row */}
              <div className="flex justify-between mt-2 text-[11px] text-gray-400">
                <span>{mo.bom_id?.[1] || ''}</span>
                {deadline && <span>Due {deadline}</span>}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No manufacturing orders in this category
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={onCreate}
        className="fixed bottom-20 right-5 w-14 h-14 rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/40 flex items-center justify-center active:scale-90 transition-transform z-40"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
