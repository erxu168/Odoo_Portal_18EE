'use client';

import React, { useState, useEffect } from 'react';
import NumPad from '@/components/ui/NumPad';

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

  const [numpadComp, setNumpadComp] = useState<any>(null);
  const [numpadSaving, setNumpadSaving] = useState(false);

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { fetchDetail(); }, [moId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionError) { const t = setTimeout(() => setActionError(null), 5000); return () => clearTimeout(t); }
  }, [actionError]);

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

  async function handleConfirm() {
    setConfirmLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchDetail();
    } catch (err: any) {
      setActionError(err.message || 'Failed to confirm order');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleCancel() {
    setShowCancelConfirm(false);
    setCancelLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchDetail();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel order');
    } finally {
      setCancelLoading(false);
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
      // Navigate back to MO list after successful produce
      onBack();
    } catch (err: any) {
      setProduceError(err.message || 'Failed to produce');
      setProducing(false);
    }
  }

  async function handleNumpadConfirm(value: number) {
    if (!numpadComp) return;
    setNumpadSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component_updates: [{ move_id: numpadComp.id, consumed_qty: value }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNumpadComp(null);
      await fetchDetail();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update quantity');
    } finally {
      setNumpadSaving(false);
    }
  }

  const stateColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-orange-50 text-orange-700',
    progress: 'bg-amber-50 text-amber-700', done: 'bg-emerald-50 text-emerald-700',
    to_close: 'bg-blue-50 text-blue-700', cancel: 'bg-red-50 text-red-700',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress',
    done: 'Done', to_close: 'To Close', cancel: 'Cancelled',
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
  const isDraft = mo.state === 'draft';
  const isDone = mo.state === 'done';
  const isCancelled = mo.state === 'cancel';
  const isToClose = mo.state === 'to_close';
  const canCancel = !isDone && !isCancelled;
  const showProduce = !isDraft && !isDone && !isCancelled && (allWosDone || isToClose || workOrders.length === 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="flex items-center gap-1 text-orange-600 text-[13px] font-semibold active:opacity-70">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Production
          </button>
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelLoading}
              className="text-[12px] text-red-500 font-semibold px-3 py-1 rounded-lg border border-red-200 active:bg-red-50 disabled:opacity-50"
            >
              {cancelLoading ? 'Cancelling...' : 'Cancel order'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-[18px] font-bold text-gray-900">{mo.product_id[1]}</h1>
            <p className="text-[13px] text-gray-500 mt-0.5">{mo.name} &middot; {mo.bom_id?.[1] || ''}</p>
          </div>
          <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold ${stateColors[mo.state] || 'bg-gray-100 text-gray-600'}`}>
            {stateLabels[mo.state] || mo.state}
          </span>
        </div>
      </div>

      {actionError && (
        <div className="px-4 pt-3">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-[13px]">{actionError}</div>
        </div>
      )}

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
          <button onClick={() => setTab('workorders')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide transition-all ${tab === 'workorders' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500'}`}>
            Steps ({workOrders.length})
          </button>
          <button onClick={() => setTab('components')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide transition-all ${tab === 'components' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500'}`}>
            Ingredients ({components.length})
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 pb-28">
        {tab === 'workorders' && (
          <div className="flex flex-col gap-2">
            {workOrders.map((wo, idx) => (
              <button key={wo.id} onClick={() => onOpenWo(wo.id)}
                className={`bg-white border rounded-xl p-4 text-left active:scale-[0.98] transition-all ${wo.state === 'progress' ? 'border-orange-200 shadow-sm' : 'border-gray-200'}`}>
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
                    {wo.duration > 0 && (
                      <span className={`font-semibold ${wo.state === 'done' ? 'text-emerald-600' : 'text-orange-600'}`}>{Math.floor(wo.duration)}m</span>
                    )}
                    {wo.duration_expected > 0 && <span>/ {Math.round(wo.duration_expected)}m expected</span>}
                  </div>
                )}
              </button>
            ))}
            {workOrders.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No steps for this order</div>}
          </div>
        )}

        {tab === 'components' && (
          <div className="flex flex-col gap-1.5">
            {components.length > 0 && <p className="text-[11px] text-gray-400 mb-1 px-1">Tap an ingredient to set the quantity</p>}
            {components.map((c: any) => {
              const consumed = c.consumed_qty || 0;
              const required = c.product_uom_qty || 0;
              const isDoneComp = c.is_done || c.state === 'done';
              const partial = consumed > 0 && !isDoneComp;
              const compUom = c.product_uom?.[1] || 'kg';
              const accentColor = isDoneComp ? 'bg-emerald-500' : partial ? 'bg-orange-400' : 'bg-gray-200';
              const qtyColor = isDoneComp ? 'text-emerald-600' : partial ? 'text-orange-600' : 'text-gray-900';
              return (
                <button key={c.id} onClick={() => !isDoneComp && setNumpadComp(c)}
                  className={`bg-white border border-gray-200 rounded-xl flex overflow-hidden text-left ${!isDoneComp ? 'active:scale-[0.98] transition-transform' : ''}`}>
                  <div className={`w-1 flex-shrink-0 ${accentColor}`} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${isDoneComp ? 'text-emerald-600' : 'text-gray-900'}`}>{c.product_id[1]}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{isDoneComp ? 'Consumed' : partial ? 'Partial' : 'Tap to set qty'}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-[15px] font-bold tabular-nums font-mono ${qtyColor}`}>
                        {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(consumed)} / {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(required)}
                      </div>
                      <div className="text-[11px] text-gray-400">{compUom}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {components.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">No ingredients</div>}
          </div>
        )}
      </div>

      {/* Bottom CTA area */}
      {produceError && (
        <div className="fixed bottom-24 left-0 right-0 max-w-lg mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm">{produceError}</div>
        </div>
      )}

      {isDraft && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <button onClick={handleConfirm} disabled={confirmLoading}
            className="w-full py-4 rounded-xl bg-orange-500 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-transform disabled:opacity-50">
            {confirmLoading ? 'Confirming...' : 'Confirm order'}
          </button>
        </div>
      )}

      {showProduce && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <button onClick={handleProduce} disabled={producing}
            className="w-full py-4 rounded-xl bg-emerald-500 text-white font-bold text-[15px] shadow-lg shadow-emerald-500/30 active:scale-[0.975] transition-transform disabled:opacity-50">
            {producing ? 'Finishing...' : 'Produce & close'}
          </button>
        </div>
      )}

      {isDone && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <div className="w-full py-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[15px] text-center">
            Order completed
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <div className="w-full py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-[15px] text-center">
            Order cancelled
          </div>
        </div>
      )}

      {numpadComp && (
        <NumPad
          label={numpadComp.product_id[1]}
          value={String(numpadComp.consumed_qty || 0)}
          unit={numpadComp.product_uom?.[1] || 'kg'}
          demandQty={numpadComp.product_uom_qty}
          loading={numpadSaving}
          onConfirm={handleNumpadConfirm}
          onClose={() => setNumpadComp(null)}
        />
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowCancelConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-8" onClick={(e) => e.stopPropagation()} style={{animation: 'slideUp .25s ease-out'}}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <div className="text-center mb-6">
              <h3 className="text-lg font-bold text-gray-900">Cancel this order?</h3>
              <p className="text-sm text-gray-500 mt-2">
                This will cancel <strong>{mo.product_id[1]}</strong> ({mo.name}).
                This action cannot be easily undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm active:bg-gray-50">Keep order</button>
              <button onClick={handleCancel} className="flex-1 py-3.5 rounded-xl bg-red-500 text-white font-bold text-sm shadow-lg shadow-red-500/30 active:scale-[0.975] transition-transform">Yes, cancel it</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
