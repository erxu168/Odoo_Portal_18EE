'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface MoDetailProps {
  moId: number;
  onBack: () => void;
  onOpenWo: (woId: number) => void;
  onPackage?: () => void;
}

export default function MoDetail({ moId, onBack, onOpenWo, onPackage }: MoDetailProps) {
  const [mo, setMo] = useState<any>(null);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'workorders' | 'components' | 'overview'>('components');
  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);


  const [confirmLoading, setConfirmLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { fetchDetail(); }, [moId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionError) { const t = setTimeout(() => setActionError(null), 5000); return () => clearTimeout(t); }
  }, [actionError]);

  const pickedKey = `mo-picked-${moId}`;

  async function fetchDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`);
      const data = await res.json();
      setMo(data.order);
      setWorkOrders(data.order?.work_orders || []);
      const comps = data.order?.components || [];
      // Restore picked state from localStorage
      try {
        const saved: Record<string, boolean> = JSON.parse(localStorage.getItem(pickedKey) || '{}');
        for (const c of comps) {
          if (saved[c.id] !== undefined) c.picked = saved[c.id];
        }
      } catch {}
      setComponents(comps);
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
      onBack();
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
      onBack();
    } catch (err: any) {
      setProduceError(err.message || 'Failed to produce');
      setProducing(false);
    }
  }

  function toggleIngredient(comp: any) {
    setComponents(prev => {
      const next = prev.map(c =>
        c.id === comp.id ? { ...c, picked: !c.picked } : c
      );
      // Persist picked state to localStorage
      const saved: Record<string, boolean> = {};
      for (const c of next) saved[c.id] = !!c.picked;
      localStorage.setItem(pickedKey, JSON.stringify(saved));
      return next;
    });
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

  const stateColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-green-50 text-green-800',
    progress: 'bg-amber-50 text-amber-700', done: 'bg-green-50 text-green-700',
    to_close: 'bg-blue-50 text-blue-700', cancel: 'bg-red-50 text-red-700',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress',
    done: 'Done', to_close: 'To Close', cancel: 'Cancelled',
  };
  const woStateColors: Record<string, string> = {
    ready: 'bg-green-50 text-green-800', progress: 'bg-amber-50 text-amber-700',
    pending: 'bg-gray-100 text-gray-500', done: 'bg-green-50 text-green-700',
    waiting: 'bg-gray-100 text-gray-500',
  };
  const woStateLabels: Record<string, string> = {
    ready: 'Ready', progress: 'In Progress', pending: 'Waiting', done: 'Done', waiting: 'Waiting',
  };
  const woStepColors: Record<string, string> = {
    ready: 'bg-green-50 text-green-700', progress: 'bg-amber-50 text-amber-600',
    pending: 'bg-gray-100 text-gray-400', done: 'bg-green-50 text-green-600',
    waiting: 'bg-gray-100 text-gray-400',
  };

  if (loading || !mo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  const doneWos = workOrders.filter((w) => w.state === 'done').length;
  const allWosDone = workOrders.length > 0 && workOrders.every((w: any) => w.state === 'done');
  const isDraft = mo.state === 'draft';
  const isDone = mo.state === 'done';
  const isCancelled = mo.state === 'cancel';
  const isToClose = mo.state === 'to_close';
  const canCancel = !isDone && !isCancelled;
  const showProduce = !isDraft && !isDone && !isCancelled && (allWosDone || workOrders.length === 0);

  const pickedCount = components.filter((c: any) => c.picked === true).length;
  const totalComps = components.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title={mo.product_id[1]}
        subtitle={mo.name}
        showBack
        onBack={onBack}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.open(`/api/manufacturing-orders/${moId}/print`, '_blank')}
              className="w-[clamp(36px,10vw,44px)] h-[clamp(36px,10vw,44px)] rounded-xl bg-white/15 border border-white/20 flex items-center justify-center active:bg-white/25"
              title="Print"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </button>
            <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-semibold ${stateColors[mo.state] || 'bg-gray-100 text-gray-600'}`}>
              {stateLabels[mo.state] || mo.state}
            </span>
          </div>
        }
      />

      {actionError && (
        <div className="px-4 pt-3">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-[var(--fs-xs)]">{actionError}</div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">QUANTITY</div>
            <div className="text-lg font-bold text-green-600 mt-0.5 font-mono">{mo.qty_producing} / {mo.product_qty}</div>
          </div>
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">STEPS</div>
            <div className="text-lg font-bold text-amber-500 mt-0.5 font-mono">{doneWos} / {workOrders.length}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">PICKED</div>
            <div className="text-lg font-bold text-green-500 mt-0.5 font-mono">{pickedCount} / {totalComps}</div>
          </div>
        </div>
      </div>

      <div className="px-4 mb-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button onClick={() => setTab('components')}
            className={`flex-1 py-2.5 rounded-md text-sm font-semibold tracking-wide transition-all ${tab === 'components' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500'}`}>
            Ingredients ({pickedCount}/{totalComps})
          </button>
          <button onClick={() => setTab('overview')}
            className={`flex-1 py-2.5 rounded-md text-sm font-semibold tracking-wide transition-all ${tab === 'overview' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500'}`}>
            Overview
          </button>
          <button onClick={() => setTab('workorders')}
            className={`flex-1 py-2.5 rounded-md text-sm font-semibold tracking-wide transition-all ${tab === 'workorders' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500'}`}>
            Steps ({workOrders.length})
          </button>
        </div>
      </div>

      <div className="px-4 pb-8">
        {tab === 'workorders' && (
          <div className="flex flex-col gap-1">
            {(() => {
              const wcNames = Array.from(new Set(workOrders.map((wo: any) => wo.workcenter_id[1])));
              return wcNames.map(wc => {
                const wcWos = workOrders.filter((wo: any) => wo.workcenter_id[1] === wc);
                const wcDone = wcWos.filter((wo: any) => wo.state === 'done').length;
                return (
                  <div key={wc} className="mb-3">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-1.5 flex justify-between">
                      <span>{wc}</span>
                      <span className="font-mono text-gray-300">{wcDone}/{wcWos.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {wcWos.map((wo: any) => {
                        const globalIdx = workOrders.indexOf(wo);
                        return (
                          <button key={wo.id} onClick={() => onOpenWo(wo.id)}
                            className={`bg-white border rounded-xl px-4 py-2.5 text-left active:scale-[0.98] transition-all ${wo.state === 'progress' ? 'border-green-200 shadow-sm' : 'border-gray-200'}`}>
                            <div className="flex items-start gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-[var(--fs-sm)] font-extrabold flex-shrink-0 ${woStepColors[wo.state] || 'bg-gray-100 text-gray-400'}`}>
                                {globalIdx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[var(--fs-md)] font-bold text-gray-900">{wo.name}</div>
                              </div>
                              <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-semibold flex-shrink-0 ${woStateColors[wo.state] || 'bg-gray-100 text-gray-500'}`}>
                                {woStateLabels[wo.state] || wo.state}
                              </span>
                            </div>
                            {(wo.duration > 0 || wo.duration_expected > 0) && (
                              <div className="flex items-center gap-2 mt-2 pl-11 text-[var(--fs-xs)] text-gray-400">
                                {wo.duration > 0 && (
                                  <span className={`font-semibold ${wo.state === 'done' ? 'text-green-600' : 'text-green-700'}`}>{Math.floor(wo.duration)}m</span>
                                )}
                                {wo.duration_expected > 0 && <span>/ {Math.round(wo.duration_expected)}m expected</span>}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
            {workOrders.length === 0 && <div className="text-center py-8 text-gray-400 text-[var(--fs-sm)]">No steps for this order</div>}
          </div>
        )}

        {tab === 'components' && (
          <div className="flex flex-col gap-1">
            {totalComps > 0 && (
              <div className="flex items-center justify-between mb-1 px-1">
                <p className="text-[var(--fs-xs)] text-gray-400">Tap to check off each ingredient</p>
                {pickedCount === totalComps && totalComps > 0 && (
                  <span className="text-[var(--fs-xs)] font-semibold text-green-600">All picked</span>
                )}
              </div>
            )}
            {totalComps > 0 && (
              <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${totalComps > 0 ? (pickedCount / totalComps) * 100 : 0}%` }} />
              </div>
            )}
            {(() => {
              const cats = Array.from(new Set(components.map((c: any) => c.category || 'Other')));
              return cats.map(cat => {
                const catComps = components.filter((c: any) => (c.category || 'Other') === cat);
                return (
                  <div key={cat} className="mb-3">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-1.5 flex justify-between">
                      <span>{cat}</span>
                      <span className="font-mono text-gray-300">{catComps.filter((c: any) => c.picked).length}/{catComps.length}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {catComps.map((c: any) => {
                        const required = c.product_uom_qty || 0;
                        const isPicked = c.picked === true;
                        const compUom = c.product_uom?.[1] || 'kg';
                        return (
                          <button key={c.id} onClick={() => toggleIngredient(c)}
                            style={{ touchAction: 'manipulation' }}
                            className={`bg-white border rounded-2xl flex overflow-hidden text-left active:scale-[0.98] transition-all ${
                              isPicked ? 'border-green-300 bg-green-50/40' : 'border-gray-200'
                            }`}>
                            <div className={`w-1.5 flex-shrink-0 ${isPicked ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <div className="flex-1 flex items-center gap-2.5 px-3 py-1.5">
                              <div className={`w-8 h-8 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                                isPicked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
                              }`}>
                                {isPicked ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                                ) : null}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`text-[var(--fs-md)] font-bold ${isPicked ? 'text-green-700 line-through decoration-green-400/60' : 'text-gray-900'}`}>
                                  {c.product_id[1]}
                                </div>
                              </div>
                              <div className="flex items-baseline gap-1 flex-shrink-0 pl-2">
                                <span className={`text-[var(--fs-lg)] font-extrabold tabular-nums font-mono ${isPicked ? 'text-green-600' : 'text-gray-900'}`}>
                                  {fmt(required)}
                                </span>
                                <span className={`text-[var(--fs-xs)] font-semibold ${isPicked ? 'text-green-500' : 'text-gray-400'}`}>{compUom}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
            {components.length === 0 && <div className="text-center py-8 text-gray-400 text-[var(--fs-sm)]">No ingredients</div>}
          </div>
        )}

        {tab === 'overview' && (
          <div className="flex flex-col gap-4">
            {workOrders.length > 0 ? workOrders.map((wo: any, idx: number) => {
              const hasNote = wo.operation_note && wo.operation_note !== '<p><br></p>' && wo.operation_note.replace(/<[^>]*>/g, '').trim().length > 0;
              return (
                <div key={wo.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fs-xs)] font-extrabold flex-shrink-0 ${woStepColors[wo.state] || 'bg-gray-100 text-gray-400'}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-md)] font-bold text-gray-900">{wo.name}</div>
                      <div className="text-[var(--fs-xs)] text-gray-400 font-semibold">{wo.workcenter_id[1]}</div>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {hasNote ? (
                      <div
                        className="text-[var(--fs-sm)] text-gray-700 leading-relaxed prose prose-sm max-w-none
                          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1
                          [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1
                          [&_li]:my-0.5
                          [&_p]:my-1
                          [&_strong]:font-bold
                          [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1
                          [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1
                          [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-1 [&_h3]:mb-0.5"
                        dangerouslySetInnerHTML={{ __html: wo.operation_note }}
                      />
                    ) : (
                      <p className="text-[var(--fs-sm)] text-gray-300 italic">No instructions</p>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="text-center py-8 text-gray-400 text-[var(--fs-sm)]">No steps for this order</div>
            )}
          </div>
        )}
      </div>

      {produceError && (
        <div className="px-4 pb-3">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-red-700 text-[var(--fs-sm)]">{produceError}</div>
        </div>
      )}

      {isDraft && (
        <div className="px-4 pb-6">
          <div className="flex gap-2">
            <button onClick={() => setShowCancelConfirm(true)} disabled={cancelLoading}
              className="py-4 px-6 rounded-xl bg-white border border-red-200 text-red-500 font-bold text-[var(--fs-sm)] active:bg-red-50 disabled:opacity-50">
              {cancelLoading ? '...' : 'Cancel'}
            </button>
            <button onClick={handleConfirm} disabled={confirmLoading}
              className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
              {confirmLoading ? 'Confirming...' : 'Confirm order'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmed but not ready to produce — show cancel button */}
      {!isDraft && !isDone && !isCancelled && !showProduce && (
        <div className="px-4 pb-6">
          <button onClick={() => setShowCancelConfirm(true)} disabled={cancelLoading}
            className="w-full py-4 rounded-xl bg-white border border-red-200 text-red-500 font-bold text-[var(--fs-sm)] active:bg-red-50 disabled:opacity-50">
            {cancelLoading ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      )}

      {showProduce && (
        <div className="px-4 pb-6">
          <div className="flex flex-col gap-2">
            {/* Package & Label — partial produce with lot tracking */}
            {onPackage && (
              <button onClick={onPackage}
                className="w-full py-4 rounded-xl bg-[#2563EB] text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-blue-600/30 active:scale-[0.975] transition-transform flex items-center justify-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                Package &amp; Label
              </button>
            )}
            <div className="flex gap-2">
              {canCancel && (
                <button onClick={() => setShowCancelConfirm(true)} disabled={cancelLoading}
                  className="py-4 px-6 rounded-xl bg-white border border-red-200 text-red-500 font-bold text-[var(--fs-sm)] active:bg-red-50 disabled:opacity-50">
                  {cancelLoading ? '...' : 'Cancel'}
                </button>
              )}
              <button onClick={handleProduce} disabled={producing}
                className="flex-1 py-4 rounded-xl bg-green-500 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-500/30 active:scale-[0.975] transition-transform disabled:opacity-50">
                {producing ? 'Finishing...' : 'Produce & close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDone && (
        <div className="px-4 pb-6">
          <div className="flex flex-col gap-2">
            <div className="w-full py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 font-bold text-[var(--fs-md)] text-center">Order completed</div>
            {onPackage && (
              <button onClick={onPackage}
                className="w-full py-3 rounded-xl bg-white border border-blue-200 text-blue-600 font-bold text-[var(--fs-sm)] active:bg-blue-50 flex items-center justify-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                Reprint Labels
              </button>
            )}
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="px-4 pb-6">
          <div className="w-full py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-[var(--fs-md)] text-center">Order cancelled</div>
        </div>
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowCancelConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-24" onClick={(e) => e.stopPropagation()} style={{animation: 'slideUp .25s ease-out'}}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <div className="text-center mb-6">
              <h3 className="text-lg font-bold text-gray-900">Cancel this order?</h3>
              <p className="text-sm text-gray-500 mt-2">
                This will cancel <strong>{mo.product_id[1]}</strong> ({mo.name}).
                This action cannot be easily undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-[var(--fs-sm)] active:bg-gray-50">Keep order</button>
              <button onClick={handleCancel} className="flex-1 py-3.5 rounded-xl bg-red-500 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-red-500/30 active:scale-[0.975] transition-transform">Yes, cancel it</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
