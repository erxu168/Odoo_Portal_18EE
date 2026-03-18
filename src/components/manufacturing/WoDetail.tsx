'use client';

import React, { useState, useEffect, useRef } from 'react';

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
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'components' | 'instructions'>('components');

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
      setComponents(data.order?.components || []);
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

  async function handleAction(action: string) {
    try {
      await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (action === 'confirm') {
        // For now just go back since individual WO actions need their own endpoint
      }
    } catch (err) {
      console.error(`WO action ${action} failed:`, err);
    }
  }

  function toggleTimer() {
    setRunning((r) => !r);
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-3.5 pb-3.5 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-1 text-indigo-500 text-[13px] active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          {mo.product_id[1]}
        </button>
        <h1 className="text-lg font-bold text-gray-900">{wo.name}</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">{wo.workcenter_id[1]} \u00b7 {components.length} components</p>
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
              <span className="text-emerald-600 font-semibold text-sm">\u2713 Completed</span>
            ) : (
              <>
                <button
                  onClick={toggleTimer}
                  className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform ${
                    running
                      ? 'bg-amber-50 text-amber-600 border border-amber-200'
                      : 'bg-emerald-500 text-white'
                  }`}
                >
                  {running ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
                  ) : (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 3l14 9-14 9V3z"/></svg>{timerSec > 0 ? 'Resume' : 'Start'}</>
                  )}
                </button>
                <button
                  onClick={onDone}
                  className="px-6 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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
            Components
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
            {components.map((c: any) => {
              const done = c.quantity || 0;
              const required = c.product_uom_qty || 0;
              const fullyDone = done >= required;
              const partial = done > 0 && !fullyDone;
              const compUom = c.product_uom?.[1] || 'kg';
              const accentColor = fullyDone ? 'bg-emerald-500' : partial ? 'bg-amber-400' : 'bg-gray-200';

              return (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl flex overflow-hidden">
                  <div className={`w-1 flex-shrink-0 ${accentColor}`} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <div className={`w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center ${
                      fullyDone ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                    }`}>
                      {fullyDone && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${fullyDone ? 'text-emerald-600 line-through' : 'text-gray-900'}`}>
                        {c.product_id[1]}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-[15px] font-bold tabular-nums ${
                        fullyDone ? 'text-emerald-600' : partial ? 'text-amber-600' : 'text-gray-900'
                      }`}>
                        {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(done)} / {new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(required)}
                      </div>
                      <div className="text-[11px] text-gray-400">{compUom}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {components.length === 0 && (
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
            onClick={onDone}
            className="w-full py-4 rounded-xl bg-indigo-500 text-white font-bold text-[15px] shadow-lg shadow-indigo-500/30 active:scale-[0.975] transition-transform"
          >
            {woIdx < allWos.length - 1 ? `Done \u2192 ${allWos[woIdx + 1]?.name || 'Next'}` : '\u2713 Mark step done'}
          </button>
        </div>
      )}
    </div>
  );
}
