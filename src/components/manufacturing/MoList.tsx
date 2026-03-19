'use client';

import React, { useState, useEffect } from 'react';

interface MoListProps {
  onSelect: (moId: number) => void;
  onCreate: () => void;
  onHome?: () => void;
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-orange-50 text-orange-700',
  progress: 'bg-amber-50 text-amber-700',
  to_close: 'bg-blue-50 text-blue-700',
  done: 'bg-emerald-50 text-emerald-700',
  cancel: 'bg-red-50 text-red-700',
};

const STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  progress: 'In Progress',
  to_close: 'Almost Done',
  done: 'Done',
  cancel: 'Cancelled',
};

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'progress', label: 'In Progress' },
  { id: 'draft', label: 'To Do' },
  { id: 'done', label: 'Done' },
];

export default function MoList({ onSelect, onCreate, onHome }: MoListProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [stats, setStats] = useState({ due: 0, active: 0, doneToday: 0 });

  useEffect(() => { fetchOrders(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchOrders() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('state', filter);
      const res = await fetch(`/api/manufacturing-orders?${params}`);
      const data = await res.json();
      setOrders(data.orders || []);
      try {
        const dRes = await fetch('/api/dashboard');
        const dData = await dRes.json();
        if (dData.production) setStats(dData.production);
      } catch (e) { void e; }
    } catch (err) {
      console.error('Failed to fetch MOs:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          {onHome && (
            <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Production</h1>
            <p className="text-[12px] text-white/50 mt-0.5">Manufacturing orders</p>
          </div>
          <button onClick={onCreate} className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center active:bg-orange-600 shadow-lg shadow-orange-500/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>

        <div className="flex gap-2 mt-4 relative">
          <div className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[16px] font-bold text-red-400 font-mono">{stats.due}</div>
            <div className="text-[10px] text-white/40 font-semibold tracking-wider mt-0.5">DUE NOW</div>
          </div>
          <div className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[16px] font-bold text-orange-400 font-mono">{stats.active}</div>
            <div className="text-[10px] text-white/40 font-semibold tracking-wider mt-0.5">ACTIVE</div>
          </div>
          <div className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 text-center">
            <div className="text-[16px] font-bold text-emerald-400 font-mono">{stats.doneToday}</div>
            <div className="text-[10px] text-white/40 font-semibold tracking-wider mt-0.5">DONE TODAY</div>
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="px-4 py-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {FILTER_TABS.map((tab) => (
            <button key={tab.id} onClick={() => setFilter(tab.id)}
              className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                filter === tab.id ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* MO cards */}
      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[13px] text-gray-400">No orders found</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {orders.map((mo: any) => {
              const pct = mo.product_qty > 0 ? Math.round((mo.qty_producing / mo.product_qty) * 100) : 0;
              const deadlineStr = mo.date_deadline
                ? new Date(mo.date_deadline).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : null;

              return (
                <button key={mo.id} onClick={() => onSelect(mo.id)}
                  className={`bg-white border rounded-2xl p-4 text-left active:scale-[0.98] transition-all ${
                    mo.state === 'progress' ? 'border-orange-200 shadow-sm' : 'border-gray-200'
                  }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-gray-400 font-mono">{mo.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${STATE_COLORS[mo.state] || 'bg-gray-100 text-gray-500'}`}>
                      {STATE_LABELS[mo.state] || mo.state}
                    </span>
                  </div>
                  <div className="text-[15px] font-bold text-gray-900 leading-tight">
                    {mo.product_id?.[1] || 'Unknown product'}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[12px] text-gray-500">
                    <span className="font-semibold">
                      Qty <span className="font-mono text-gray-900">{mo.qty_producing}/{mo.product_qty}</span> {mo.product_uom_id?.[1] || 'Units'}
                    </span>
                    {mo.work_order_count > 0 && <span>&middot; {mo.work_order_count} steps</span>}
                    {mo.move_raw_ids?.length > 0 && <span>&middot; {mo.move_raw_ids.length} comps</span>}
                  </div>
                  {(mo.state === 'progress' || mo.state === 'confirmed') && mo.product_qty > 0 && (
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-mono text-gray-400">{pct}%</span>
                    </div>
                  )}
                  {deadlineStr && (mo.state === 'confirmed' || mo.state === 'progress') && (
                    <div className="mt-2 text-[11px] text-gray-400">Due {deadlineStr}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
