'use client';

import React, { useState, useEffect } from 'react';
import DateFilter, { DateRange, isInRange } from '@/components/ui/DateFilter';
import { useCompany } from '@/lib/company-context';

interface MoListProps {
  onSelect: (moId: number) => void;
  onCreate: () => void;
  onHome?: () => void;
  mode?: 'production' | 'completed';
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-50 text-green-800',
  progress: 'bg-amber-50 text-amber-700',
  to_close: 'bg-blue-50 text-blue-700',
  done: 'bg-green-50 text-green-700',
  cancel: 'bg-red-50 text-red-700',
};

const STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  progress: 'In Progress',
  to_close: 'To Close',
  done: 'Done',
  cancel: 'Cancelled',
};

const PRODUCTION_FILTERS = [
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'draft', label: 'Draft' },
  { id: 'progress', label: 'In Progress' },
  { id: 'to_close', label: 'To Close' },
  { id: 'all', label: 'All open' },
];

const COMPLETED_FILTERS = [
  { id: 'done', label: 'Done' },
];

function fmtDate(d: string | null | false) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MoList({ onSelect, onCreate, onHome, mode = 'production' }: MoListProps) {
  const { companyId } = useCompany();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(mode === 'completed' ? 'done' : 'confirmed');
  const [datePreset, setDatePreset] = useState('today');
  const [dateRange, setDateRange] = useState<DateRange | null>(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { from: today, to: today };
  });

  useEffect(() => { if (companyId) fetchOrders(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchOrders() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders?limit=200&company_id=${companyId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err: any) {
      console.error('Failed to fetch MOs:', err);
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  const statusFiltered = orders.filter(mo => {
    if (mode === 'completed') return mo.state === 'done';
    if (statusFilter === 'all') return ['draft', 'confirmed', 'progress', 'to_close'].includes(mo.state);
    return mo.state === statusFilter;
  });

  const filtered = statusFiltered.filter(mo => {
    if (!dateRange) return true;
    const dateField = mode === 'completed' ? (mo.date_finished || mo.create_date) : (mo.date_start || mo.create_date);
    return isInRange(dateField, dateRange);
  });

  const statusTabs = mode === 'completed' ? COMPLETED_FILTERS : PRODUCTION_FILTERS;
  const title = mode === 'completed' ? 'Completed' : 'Manufacturing';
  const subtitle = mode === 'completed' ? 'Finished orders' : 'Manufacturing orders';

  function handleDateChange(preset: string, range: DateRange | null) {
    setDatePreset(preset);
    setDateRange(range);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          {onHome && (
            <button onClick={onHome} className="w-11 h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-[var(--fs-xl)] font-bold text-white truncate">{title}</h1>
            <p className="text-[var(--fs-xs)] text-white/45 mt-0.5">{subtitle}</p>
          </div>
          {mode === 'production' && (
            <button onClick={onCreate} className="w-11 h-11 rounded-xl bg-green-600 flex items-center justify-center active:bg-green-700 shadow-lg shadow-green-600/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load orders</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={fetchOrders} className="px-6 py-3 bg-green-600 text-white text-sm font-bold rounded-xl">Retry</button>
        </div>
      ) : (
        <>
          {statusTabs.length > 1 && (
            <div className="px-4 pt-3 pb-1">
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
                {statusTabs.map(tab => (
                  <button key={tab.id} onClick={() => setStatusFilter(tab.id)}
                    className={`px-4 py-3 rounded-full text-[var(--fs-sm)] font-bold whitespace-nowrap flex-shrink-0 transition-all ${
                      statusFilter === tab.id ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 pt-2 pb-3">
            <DateFilter value={datePreset} onChange={handleDateChange} />
          </div>

          <div className="px-5 pb-2">
            <span className="text-[var(--fs-xs)] font-semibold text-gray-400">{filtered.length} order{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="px-4 pb-24">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-[var(--fs-xs)] text-gray-400">No orders found</div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map((mo: any) => {
                  const pct = mo.product_qty > 0 ? Math.round((mo.qty_producing / mo.product_qty) * 100) : 0;
                  const deadlineStr = mo.date_deadline
                    ? new Date(mo.date_deadline).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : null;
                  const doneDate = fmtDate(mo.date_finished);
                  const startDate = fmtDate(mo.date_start);

                  return (
                    <button key={mo.id} onClick={() => onSelect(mo.id)}
                      className={`bg-white border rounded-2xl p-4 text-left active:scale-[0.98] transition-all ${
                        mo.state === 'progress' ? 'border-green-200 shadow-sm' : 'border-gray-200'
                      }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[var(--fs-xs)] text-gray-400 font-mono">{mo.name}</span>
                        <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-semibold ${STATE_COLORS[mo.state] || 'bg-gray-100 text-gray-500'}`}>
                          {STATE_LABELS[mo.state] || mo.state}
                        </span>
                      </div>
                      <div className="text-[var(--fs-xxl)] font-bold text-gray-900 leading-tight">
                        {mo.product_id?.[1] || 'Unknown product'}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-[var(--fs-sm)] text-gray-500">
                        <span className="font-semibold">
                          Qty <span className="font-mono text-gray-900">{mo.qty_producing}/{mo.product_qty}</span> {mo.product_uom_id?.[1] || 'Units'}
                        </span>
                        {mo.work_order_count > 0 && <span>&middot; {mo.work_order_count} steps</span>}
                        {mo.move_raw_ids?.length > 0 && <span>&middot; {mo.move_raw_ids.length} comps</span>}
                      </div>
                      {mode === 'production' && (mo.state === 'progress' || mo.state === 'confirmed') && mo.product_qty > 0 && (
                        <div className="flex items-center gap-2 mt-3">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[var(--fs-xs)] font-mono text-gray-400">{pct}%</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-[var(--fs-xs)] text-gray-400">
                        {mo.create_date && <span>Created: {fmtDate(mo.create_date)}</span>}
                        {mo.date_deadline && <span>Planned: {new Date(mo.date_deadline).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>}
                        {mode === 'production' && startDate && mo.state === 'progress' && <span>Started: {startDate}</span>}
                        {mode === 'completed' && doneDate && <span className="text-green-600 font-semibold">Done: {doneDate}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
