'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface WoDetailProps {
  moId: number;
  woId: number;
  onBack: () => void;
  onDone: () => void;
}

export default function WoDetail({ moId, woId, onBack, onDone }: WoDetailProps) {
  const [mo, setMo] = useState<any>(null);
  const [wo, setWo] = useState<any>(null);
  const [allWos, setAllWos] = useState<any[]>([]);
  const [woComponents, setWoComponents] = useState<any[]>([]);
  const [allComponents, setAllComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'components' | 'instructions'>('components');

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Timer
  const [timerSec, setTimerSec] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchData(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [woId]);

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => setTimerSec((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (actionError) {
      const t = setTimeout(() => setActionError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [actionError]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`);
      const data = await res.json();
      setMo(data.order);
      const wos = data.order?.work_orders || [];
      setAllWos(wos);
      const thisWo = wos.find((w: any) => w.id === woId);
      setWo(thisWo);

      const allComps = data.order?.components || [];
      setAllComponents(allComps);

      if (thisWo?.move_raw_ids?.length > 0) {
        const woMoveIds = new Set(thisWo.move_raw_ids);
        setWoComponents(allComps.filter((c: any) => woMoveIds.has(c.id)));
      } else {
        setWoComponents(allComps);
      }

      if (thisWo) {
        setTimerSec(Math.round((thisWo.duration || 0) * 60));
        if (thisWo.state === 'progress') setRunning(true);
      }
    } catch (err) {
      console.error('Failed to fetch WO:', err);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Call the WO action API
   */
  const callWoAction = useCallback(async (action: 'start' | 'pause' | 'done') => {
    setActionLoading(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/work-orders/${woId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err: any) {
      const msg = err.message || 'Something went wrong. Try again.';
      setActionError(msg);
      throw err;
    } finally {
      setActionLoading(null);
    }
  }, [moId, woId]);

  /**
   * Start timer — calls Odoo button_start
   */
  async function handleStart() {
    try {
      await callWoAction('start');
      setRunning(true);
    } catch { /* error already shown */ }
  }

  /**
   * Pause timer — calls Odoo button_pending
   */
  async function handlePause() {
    try {
      await callWoAction('pause');
      setRunning(false);
    } catch { /* error already shown */ }
  }

  /**
   * Toggle start/pause
   */
  function handleToggle() {
    if (running) {
      handlePause();
    } else {
      handleStart();
    }
  }

  /**
   * Done — show confirmation sheet first
   */
  function handleDoneRequest() {
    setShowConfirm(true);
  }

  /**
   * Confirmed done — calls Odoo button_finish, then navigate
   */
  async function handleDoneConfirmed() {
    setShowConfirm(false);
    try {
      await callWoAction('done');
      setRunning(false);
      // Navigate to next WO or back to MO
      const woIdx = allWos.findIndex((w: any) => w.id === woId);
      const nextWo = allWos[woIdx + 1];
      if (nextWo && nextWo.state !== 'done') {
        // Refresh data then navigate to next WO
        onDone();
      } else {
        // All done or last step — go back to MO detail
        onDone();
      }
    } catch { /* error already shown */ }
  }

  const mm = String(Math.floor(timerSec / 60)).padStart(2, '0');
  const ss = String(timerSec % 60).padStart(2, '0');

  if (loading || !wo || !mo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const woIdx = allWos.findIndex((w: any) => w.id === woId);
  const displayComps = woComponents;
  const nextWo = allWos[woIdx + 1];
  const productName = mo.product_id?.[1] || 'this product';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-3.5 pb-3.5 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-1 text-indigo-500 text-[13px] active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          {productName}
        </button>
        <h1 className="text-lg font-bold text-gray-900">{wo.name}</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">{wo.workcenter_id[1]} {"\u00b7"} {displayComps.length} components</p>
      </div>

      {/* Step progress bar */}
      <div className="flex gap-1 px-4 py-2.5">
        {allWos.map((w: any) => (
          <div
            key={w.id}
            className={`flex-1 h-1 rounded-full ${
              w.state === 'done' ? 'bg-emerald-500'
              : w.id === woId ? 'bg-indigo-500'
              : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Timer */}
      <div className="px-4 py-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <div className={`text-[52px] font-light tabular-nums tracking-widest leading-none ${
            running ? 'text-amber-500' : 'text-gray-900'
          }`}>
            {mm}:{ss}
          </div>
          <div className="text-xs text-gray-400 mt-2">
            Expected: {wo.duration_expected ? `${Math.round(wo.duration_expected)} min` : 'N/A'}
          </div>
          <div className="flex gap-3 justify-center mt-5">
            {wo.state === 'done' ? (
              <span className="text-emerald-600 font-semibold text-sm">{"\u2713"} Completed</span>
            ) : (
              <>
                <button
                  onClick={handleToggle}
                  disabled={!!actionLoading}
                  className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50 ${
                    running
                      ? 'bg-amber-50 text-amber-600 border border-amber-200'
                      : 'bg-emerald-500 text-white'
                  }`}
                >
                  {actionLoading === 'start' || actionLoading === 'pause' ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : running ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
                  ) : (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 3l14 9-14 9V3z"/></svg>{timerSec > 0 ? 'Resume' : 'Start'}</>
                  )}
                </button>
                <button
                  onClick={handleDoneRequest}
                  disabled={!!actionLoading}
                  className="px-6 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {actionLoading === 'done' ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  )}
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error toast */}
      {actionError && (
        <div className="px-4 mb-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-start gap-2">
            <span className="flex-shrink-0 mt-0.5">!</span>
            <div>
              <div className="font-semibold">Could not complete the action</div>
              <div className="text-xs mt-0.5 text-red-500">{actionError}</div>
            </div>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-1.5 px-5 py-1 text-[13px] text-gray-500">
        Step {woIdx + 1} of {allWos.length}
      </div>

      {/* Tab selector */}
      <div className="px-4 mb-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setTab('components')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
              tab === 'components' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Components ({displayComps.length})
          </button>
          <button
            onClick={() => setTab('instructions')}
            className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
              tab === 'instructions' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Instructions
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 pb-24">
        {tab === 'components' && (
          <div className="flex flex-col gap-1.5">
            {displayComps.map((c: any) => {
              const consumed = c.consumed_qty || 0;
              const required = c.product_uom_qty || 0;
              const isDone = c.is_done || c.state === 'done';
              const partial = consumed > 0 && !isDone;
              const compUom = c.product_uom?.[1] || 'kg';
              const accentColor = isDone ? 'bg-emerald-500' : partial ? 'bg-amber-400' : 'bg-gray-200';

              return (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl flex overflow-hidden">
                  <div className={`w-1 flex-shrink-0 ${accentColor}`} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className={`w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center ${
                      isDone ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                    }`}>
                      {isDone && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${isDone ? 'text-emerald-600 line-through' : 'text-gray-900'}`}>
                        {c.product_id[1]}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-[15px] font-bold tabular-nums ${
                        isDone ? 'text-emerald-600' : partial ? 'text-amber-600' : 'text-gray-900'
                      }`}>
                        {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(consumed)} / {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(required)}
                      </div>
                      <div className="text-[11px] text-gray-400">{compUom}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {displayComps.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
                No components assigned to this step
              </div>
            )}
          </div>
        )}

        {tab === 'instructions' && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
            Instructions will be available once work order operations are configured in Odoo
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {wo.state !== 'done' && (
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 pb-4 pt-2 bg-gradient-to-t from-gray-50">
          <button
            onClick={handleDoneRequest}
            disabled={!!actionLoading}
            className="w-full py-4 rounded-xl bg-indigo-500 text-white font-bold text-[15px] shadow-lg shadow-indigo-500/30 active:scale-[0.975] transition-transform disabled:opacity-50"
          >
            {actionLoading === 'done'
              ? 'Finishing...'
              : nextWo && nextWo.state !== 'done'
                ? `Done \u2192 ${nextWo.name}`
                : '\u2713 Mark step done'
            }
          </button>
        </div>
      )}

      {/* Confirmation bottom sheet */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setShowConfirm(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />
          {/* Sheet */}
          <div
            className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-8 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <div className="text-center mb-6">
              <div className="text-2xl mb-2">{"\u2705"}</div>
              <h3 className="text-lg font-bold text-gray-900">Finished this step?</h3>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                You{"\u2019"}re marking <strong>{wo.name}</strong> as done
                {productName !== 'this product' && <> for <strong>{productName}</strong></>}.
                {running && <><br />The timer will stop at <strong>{mm}:{ss}</strong>.</>}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm active:bg-gray-50"
              >
                Not yet
              </button>
              <button
                onClick={handleDoneConfirmed}
                disabled={!!actionLoading}
                className="flex-1 py-3.5 rounded-xl bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-500/30 active:scale-[0.975] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading === 'done' ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Yes, done'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-up animation */}
      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
