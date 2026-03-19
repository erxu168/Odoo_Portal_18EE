'use client';

import React, { useState, useEffect } from 'react';

interface MoListProps {
  onSelect: (moId: number) => void;
  onCreate: () => void;
  onHome?: () => void;
}

const STATE_COLORS: Record&lt;string, string&gt; = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-orange-50 text-orange-700',
  progress: 'bg-amber-50 text-amber-700',
  to_close: 'bg-blue-50 text-blue-700',
  done: 'bg-emerald-50 text-emerald-700',
  cancel: 'bg-red-50 text-red-700',
};

const STATE_LABELS: Record&lt;string, string&gt; = {
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
  const [orders, setOrders] = useState&lt;any[]&gt;([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState&lt;string | null&gt;(null);
  const [filter, setFilter] = useState('all');
  const [stats, setStats] = useState({ due: 0, active: 0, doneToday: 0 });

  useEffect(() => { fetchOrders(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchOrders() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('state', filter);
      const res = await fetch(`/api/manufacturing-orders?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.orders || []);
      try {
        const dRes = await fetch('/api/dashboard');
        const dData = await dRes.json();
        if (dData.production) setStats(dData.production);
      } catch (e) { void e; }
    } catch (err: any) {
      console.error('Failed to fetch MOs:', err);
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  return (
    &lt;div className="min-h-screen bg-gray-50"&gt;
      {/* Header */}
      &lt;div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden"&gt;
        &lt;div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" /&gt;
        &lt;div className="flex items-center gap-3 relative"&gt;
          {onHome &amp;&amp; (
            &lt;button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20"&gt;
              &lt;svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"&gt;&lt;path d="M15 19l-7-7 7-7"/&gt;&lt;/svg&gt;
            &lt;/button&gt;
          )}
          &lt;div className="flex-1"&gt;
            &lt;h1 className="text-[20px] font-bold text-white"&gt;Production&lt;/h1&gt;
            &lt;p className="text-[12px] text-white/50 mt-0.5"&gt;Manufacturing orders&lt;/p&gt;
          &lt;/div&gt;
          &lt;button onClick={onCreate} className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center active:bg-orange-600 shadow-lg shadow-orange-500/30"&gt;
            &lt;svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"&gt;&lt;path d="M12 5v14M5 12h14"/&gt;&lt;/svg&gt;
          &lt;/button&gt;
        &lt;/div&gt;
      &lt;/div&gt;

      {/* Error state */}
      {error ? (
        &lt;div className="flex flex-col items-center justify-center px-6 py-16"&gt;
          &lt;div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center"&gt;
            &lt;svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"&gt;
              &lt;circle cx="12" cy="12" r="10"/&gt;&lt;line x1="12" y1="8" x2="12" y2="12"/&gt;&lt;line x1="12" y1="16" x2="12.01" y2="16"/&gt;
            &lt;/svg&gt;
          &lt;/div&gt;
          &lt;p className="text-[15px] text-gray-900 font-bold mb-1"&gt;Could not load orders&lt;/p&gt;
          &lt;p className="text-[13px] text-gray-500 mb-5 text-center"&gt;{error}&lt;/p&gt;
          &lt;button onClick={fetchOrders} className="px-6 py-3 bg-orange-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-orange-500/30 active:scale-95 transition-transform"&gt;Retry&lt;/button&gt;
        &lt;/div&gt;
      ) : (
        &lt;&gt;
          {/* Stats strip */}
          &lt;div className="px-5 py-3"&gt;
            &lt;div className="flex gap-2"&gt;
              &lt;div className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center"&gt;
                &lt;div className="text-[16px] font-bold text-red-500 font-mono"&gt;{stats.due}&lt;/div&gt;
                &lt;div className="text-[10px] text-gray-400 font-semibold tracking-wider mt-0.5"&gt;DUE NOW&lt;/div&gt;
              &lt;/div&gt;
              &lt;div className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center"&gt;
                &lt;div className="text-[16px] font-bold text-orange-500 font-mono"&gt;{stats.active}&lt;/div&gt;
                &lt;div className="text-[10px] text-gray-400 font-semibold tracking-wider mt-0.5"&gt;ACTIVE&lt;/div&gt;
              &lt;/div&gt;
              &lt;div className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center"&gt;
                &lt;div className="text-[16px] font-bold text-emerald-500 font-mono"&gt;{stats.doneToday}&lt;/div&gt;
                &lt;div className="text-[10px] text-gray-400 font-semibold tracking-wider mt-0.5"&gt;DONE TODAY&lt;/div&gt;
              &lt;/div&gt;
            &lt;/div&gt;
          &lt;/div&gt;

          {/* Filter pills */}
          &lt;div className="px-4 pb-3"&gt;
            &lt;div className="flex gap-1.5 overflow-x-auto no-scrollbar"&gt;
              {FILTER_TABS.map((tab) =&gt; (
                &lt;button key={tab.id} onClick={() =&gt; setFilter(tab.id)}
                  className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                    filter === tab.id ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
                  }`}&gt;
                  {tab.label}
                &lt;/button&gt;
              ))}
            &lt;/div&gt;
          &lt;/div&gt;

          {/* MO cards */}
          &lt;div className="px-4 pb-24"&gt;
            {loading ? (
              &lt;div className="flex justify-center py-12"&gt;
                &lt;div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" /&gt;
              &lt;/div&gt;
            ) : orders.length === 0 ? (
              &lt;div className="text-center py-12"&gt;
                &lt;div className="text-[13px] text-gray-400"&gt;No orders found&lt;/div&gt;
              &lt;/div&gt;
            ) : (
              &lt;div className="flex flex-col gap-3"&gt;
                {orders.map((mo: any) =&gt; {
                  const pct = mo.product_qty &gt; 0 ? Math.round((mo.qty_producing / mo.product_qty) * 100) : 0;
                  const deadlineStr = mo.date_deadline
                    ? new Date(mo.date_deadline).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : null;

                  return (
                    &lt;button key={mo.id} onClick={() =&gt; onSelect(mo.id)}
                      className={`bg-white border rounded-2xl p-4 text-left active:scale-[0.98] transition-all ${
                        mo.state === 'progress' ? 'border-orange-200 shadow-sm' : 'border-gray-200'
                      }`}&gt;
                      &lt;div className="flex items-center justify-between mb-1.5"&gt;
                        &lt;span className="text-[11px] text-gray-400 font-mono"&gt;{mo.name}&lt;/span&gt;
                        &lt;span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${STATE_COLORS[mo.state] || 'bg-gray-100 text-gray-500'}`}&gt;
                          {STATE_LABELS[mo.state] || mo.state}
                        &lt;/span&gt;
                      &lt;/div&gt;
                      &lt;div className="text-[15px] font-bold text-gray-900 leading-tight"&gt;
                        {mo.product_id?.[1] || 'Unknown product'}
                      &lt;/div&gt;
                      &lt;div className="flex items-center gap-3 mt-2 text-[12px] text-gray-500"&gt;
                        &lt;span className="font-semibold"&gt;
                          Qty &lt;span className="font-mono text-gray-900"&gt;{mo.qty_producing}/{mo.product_qty}&lt;/span&gt; {mo.product_uom_id?.[1] || 'Units'}
                        &lt;/span&gt;
                        {mo.work_order_count &gt; 0 &amp;&amp; &lt;span&gt;&amp;middot; {mo.work_order_count} steps&lt;/span&gt;}
                        {mo.move_raw_ids?.length &gt; 0 &amp;&amp; &lt;span&gt;&amp;middot; {mo.move_raw_ids.length} comps&lt;/span&gt;}
                      &lt;/div&gt;
                      {(mo.state === 'progress' || mo.state === 'confirmed') &amp;&amp; mo.product_qty &gt; 0 &amp;&amp; (
                        &lt;div className="flex items-center gap-2 mt-3"&gt;
                          &lt;div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"&gt;
                            &lt;div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} /&gt;
                          &lt;/div&gt;
                          &lt;span className="text-[11px] font-mono text-gray-400"&gt;{pct}%&lt;/span&gt;
                        &lt;/div&gt;
                      )}
                      {deadlineStr &amp;&amp; (mo.state === 'confirmed' || mo.state === 'progress') &amp;&amp; (
                        &lt;div className="mt-2 text-[11px] text-gray-400"&gt;Due {deadlineStr}&lt;/div&gt;
                      )}
                    &lt;/button&gt;
                  );
                })}
              &lt;/div&gt;
            )}
          &lt;/div&gt;
        &lt;/&gt;
      )}
    &lt;/div&gt;
  );
}
