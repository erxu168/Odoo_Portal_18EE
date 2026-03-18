'use client';

import React, { useState, useEffect } from 'react';

interface MoDetailProps {
  moId: number;
  onBack: () => void;
  onOpenWo: (woId: number) => void;
}

export default function MoDetail({ moId, onBack, onOpenWo }: MoDetailProps) {
  const [mo, setMo] = useState<any>(null);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'workorders' | 'components'>('workorders');
  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);

  useEffect(() => { fetchDetail(); }, [moId]);

  async function fetchDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`);
      const data = await res.json();
      setMo(data.order);
      setWorkOrders(data.order?.work_orders || []);
      setComponents(data.order?.components || []);
    } catch (err) {
      console.error('Failed to fetch MO detail:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleProduce() {
    setProducing(true);
    setProduceError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_done' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchDetail();
    } catch (err: any) {
      setProduceError(err.message || 'Failed to produce');
    } finally {
      setProducing(false);
    }
  }

  const stateColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-orange-50 text-orange-700',
    progress: 'bg-amber-50 text-amber-700', done: 'bg-emerald-50 text-emerald-700',
    cancel: 'bg-red-50 text-red-700',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress', done: 'Done', cancel: 'Cancelled',
  };
  const woStateColors: Record<string, string> = {
    ready: 'bg-orange-50 text-orange-700', progress: 'bg-amber-50 text-amber-700',
    pending: 'bg-gray-100 text-gray-500', done: 'bg-emerald-50 text-emerald-700',
    waiting: 'bg-gray-100 text-gray-500',
  };
  const woStateLabels: Record<string, string> = {
    ready: 'Ready', progress: 'In Progress', pending: 'Waiting', done: 'Done', waiting: 'Waiting',
  };
  const woStepColors: Record<string, string> = {
    ready: 'bg-orange-50 text-orange-600', progress: 'bg-amber-50 text-amber-600',
    pending: 'bg-gray-100 text-gray-400', done: 'bg-emerald-50 text-emerald-600',
    waiting: 'bg-gray-100 text-gray-400',
  };

  if (loading || !mo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  const doneWos = workOrders.filter((w) => w.state === 'done').length;
  const doneComps = components.filter((c) => c.is_done || c.state === 'done').length;
  const allWosDone = workOrders.length > 0 && workOrders.every((w: any) => w.state === 'done');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-2 text-orange-600 text-[13px] font-semibold active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Production
        </button>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-[18px] font-bold text-gray-900">{mo.product_id[1]}</h1>
            <p className="text-[13px] text-gray-500 mt-0.5">{mo.name} {"\u00b7"} {mo.bom_id?.[1] || ''}</p>
          </div>
          <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold ${stateColors[mo.state]}`}>
            {stateLabels[mo.state]}
          </span>
        </div>
      </div>

      {/* Summary strip */}
      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">QUANTITY</div>
            <div className="text-lg font-bold text-orange-500 mt-0.5 font-mono">{mo.qty_producing} / {mo.product_qty}</div>
          </div>
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">STEPS</div>
            <div className="text-lg font-bold text-amber-500 mt-0.5 font-mono">{doneWos} / {workOrders.length}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">INGREDIENTS</div>
            <div className="text-lg font-bold text-emerald-500 mt-0.5 font-mono">{doneComps} / {components.length}</div>
          </div>
        </div>
      </div>

      {/* Tab selector */}
      <div className="px-4 mb-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setTab('workorders')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide transition-all ${
              tab === 'workorders' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Steps ({workOrders.length})
          </button>
          <button
            onClick={() => setTab('components')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide transition-all ${
              tab === 'components' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Ingredients ({components.length})
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 pb-24">
        {tab === 'workorders' && (
          <div className="flex flex-col gap-2">
            {workOrders.map((wo, idx) => (
              <button
                key={wo.id}
                onClick={() => onOpenWo(wo.id)}
                className={`bg-white border rounded-xl p-4 text-left active:scale-[0.98] transition-all ${
                  wo.state === 'progress' ? 'border-orange-200 shadow-sm' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-extrabold flex-shrink-0 ${woStepColors[wo.state] || 'bg-gray-100 text-gray-400'}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-gray-900">{wo.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{wo.workcenter_id[1]}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold flex-shrink-0 ${woStateColors[wo.state] || 'bg-gray-100 text-gray-500'}`}>
                    {woStateLabels[wo.state] || wo.state}
                  </span>
                </div>
                {(wo.duration > 0 || wo.duration_expected > 0) && (
                  <div className="flex items-center gap-2 mt-2 pl-11 text-[11px] text-gray-400">
                    <span>{"\u23F1"}</span>
                    {wo.duration > 0 && (
                      <span className={`font-semibold ${wo.state === 'done' ? 'text-emerald-600' : 'text-orange-600'}`}>
                        {Math.floor(wo.duration)}m
                      </span>
                    )}
                    {wo.duration_expected > 0 && (
                      <span>/ {Math.round(wo.duration_expected)}m expected</span>
                    )}
                  </div>
                )}
              </button>
            ))}
            {workOrders.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">No steps for this order</div>
            )}
          </div>
        )}

        {tab === 'components' && (
          <div className="flex flex-col gap-1.5">
            {components.map((c: any) => {
              const consumed = c.consumed_qty || 0;
              const required = c.product_uom_qty || 0;
              const isDone = c.is_done || c.state === 'done';
              const partial = consumed > 0 && !isDone;
              const compUom = c.product_uom?.[1] || 'kg';
              const accentColor = isDone ? 'bg-emerald-500' : partial ? 'bg-orange-400' : 'bg-gray-200';
              const qtyColor = isDone ? 'text-emerald-600' : partial ? 'text-orange-600' : 'text-gray-900';

              return (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl flex overflow-hidden">
                  <div className={`w-1 flex-shrink-0 ${accentColor}`} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${isDone ? 'text-emerald-600' : 'text-gray-900'}`}>
                        {c.product_id[1]}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {isDone ? '\u2713 Consumed' : partial ? 'Partial' : 'Pending'}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-[15px] font-bold tabular-nums font-mono ${qtyColor}`}>
                        {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(consumed)} / {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(required)}
                      </div>
                      <div className="text-[11px] text-gray-400">{compUom}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {components.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">No ingredients</div>
            )}
          </div>
        )}
      </div>

      {/* Produce & Close CTA */}
      {produceError && (
        <div className="fixed bottom-20 left-0 right-0 max-w-lg mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm">{produceError}</div>
        </div>
      )}
      {mo.state === 'done' && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <div className="w-full py-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[15px] text-center">
            {"\u2713"} Order completed
          </div>
        </div>
      )}
      {mo.state !== 'done' && allWosDone && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <button
            onClick={handleProduce}
            disabled={producing}
            className="w-full py-4 rounded-xl bg-orange-500 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-transform disabled:opacity-50"
          >
            {producing ? 'Finishing...' : '\u2713 Produce & close'}
          </button>
        </div>
      )}
    </div>
  );
}
