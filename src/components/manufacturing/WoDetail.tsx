'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Numpad from '@/components/ui/Numpad';
import PdfViewer from '@/components/ui/PdfViewer';

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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'components' | 'instructions'>('components');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [timerSec, setTimerSec] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [worksheetType, setWorksheetType] = useState<string>('');
  const [operationNote, setOperationNote] = useState<string>('');
  const [worksheetPdf, setWorksheetPdf] = useState<string>('');
  const [worksheetGoogleSlide, setWorksheetGoogleSlide] = useState<string>('');

  const [numpadComp, setNumpadComp] = useState<any>(null);
  const [numpadSaving, setNumpadSaving] = useState(false);
  const [tolerancePct, setTolerancePct] = useState<number>(5);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => { fetchData(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [woId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => setTimerSec((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  useEffect(() => {
    if (actionError) { const t = setTimeout(() => setActionError(null), 5000); return () => clearTimeout(t); }
  }, [actionError]);

  async function fetchData() {
    setLoading(true);
    try {
      const moRes = await fetch(`/api/manufacturing-orders/${moId}`);
      const moData = await moRes.json();
      setMo(moData.order);
      const wos = moData.order?.work_orders || [];
      setAllWos(wos);
      const thisWo = wos.find((w: any) => w.id === woId);
      setWo(thisWo);

      const allComps = moData.order?.components || [];
      const woOperationId = thisWo?.operation_id?.[0] || null;

      if (woOperationId) {
        const assigned = allComps.filter((c: any) => c.operation_id?.[0] === woOperationId);
        if (assigned.length > 0) {
          setWoComponents(assigned);
        } else {
          setWoComponents(allComps);
        }
      } else {
        setWoComponents(allComps);
      }

      if (thisWo) {
        setTimerSec(Math.round((thisWo.duration || 0) * 60));
        if (thisWo.state === 'progress') setRunning(true);
      }

      const woRes = await fetch(`/api/manufacturing-orders/${moId}/work-orders/${woId}`);
      const woData = await woRes.json();
      const woDetail = woData.work_order || {};
      setWorksheetType(woDetail.worksheet_type || '');
      setOperationNote(woDetail.operation_note || '');
      setWorksheetPdf(woDetail.worksheet || '');
      setWorksheetGoogleSlide(woDetail.worksheet_google_slide || '');

      // Fetch tolerance for this BOM
      const bomId = moData.order?.bom_id?.[0];
      if (bomId) {
        try {
          const tolRes = await fetch(`/api/bom-tolerance?bom_id=${bomId}`);
          const tolData = await tolRes.json();
          setTolerancePct(tolData.tolerance_pct ?? 5);
        } catch { /* fallback to default */ }
      }
    } catch (err) { console.error('Failed to fetch WO:', err); }
    finally { setLoading(false); }
  }

  const callWoAction = useCallback(async (action: 'start' | 'pause' | 'done') => {
    setActionLoading(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/work-orders/${woId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err: any) {
      setActionError(err.message || 'Something went wrong.');
      throw err;
    } finally { setActionLoading(null); }
  }, [moId, woId]);

  async function handleStart() { try { await callWoAction('start'); setRunning(true); } catch (e) { void e; } }
  async function handlePause() { try { await callWoAction('pause'); setRunning(false); } catch (e) { void e; } }
  function handleToggle() { if (running) { handlePause(); } else { handleStart(); } }
  function handleDoneRequest() { setShowConfirm(true); }

  async function handleDoneConfirmed() {
    setShowConfirm(false);
    try { await callWoAction('done'); setRunning(false); onDone(); } catch (e) { void e; }
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
      await fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update quantity');
    } finally {
      setNumpadSaving(false);
    }
  }

  function sanitizeHtml(html: string) {
    return html
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<style[^>]*>.*?<\/style>/gi, '');
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);
  const mm = String(Math.floor(timerSec / 60)).padStart(2, '0');
  const ss = String(timerSec % 60).padStart(2, '0');

  if (loading || !wo || !mo) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>;
  }

  const woIdx = allWos.findIndex((w: any) => w.id === woId);
  const displayComps = woComponents;
  const nextWo = allWos[woIdx + 1];
  const productName = mo.product_id?.[1] || 'this product';

  const hasText = operationNote && operationNote.trim().length > 0 && operationNote !== '<p><br></p>';
  const hasPdf = worksheetType === 'pdf' && worksheetPdf;
  const hasGoogleSlide = worksheetType === 'google_slide' && worksheetGoogleSlide;
  const hasInstructions = hasText || hasPdf || hasGoogleSlide;

  const arrow = '\u2192';

  const pickedCount = displayComps.filter((c: any) => c.picked === true).length;
  const totalComps = displayComps.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-2 text-green-700 text-[13px] font-semibold active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          {productName}
        </button>
        <h1 className="text-[18px] font-bold text-gray-900">{wo.name}</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">{wo.workcenter_id[1]} {'\u00b7'} {displayComps.length} ingredients</p>
      </div>

      <div className="flex gap-1 px-4 py-2.5">
        {allWos.map((w: any) => (
          <div key={w.id} className={`flex-1 h-1 rounded-full ${w.state === 'done' ? 'bg-green-500' : w.id === woId ? 'bg-green-600' : 'bg-gray-200'}`} />
        ))}
      </div>

      <div className="px-4 py-3">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <div className={`text-[52px] font-light tabular-nums tracking-widest leading-none font-mono ${running ? 'text-green-600' : 'text-gray-900'}`}>
            {mm}:{ss}
          </div>
          <div className="text-xs text-gray-400 mt-2">Expected: {wo.duration_expected ? `${Math.round(wo.duration_expected)} min` : 'N/A'}</div>
          <div className="flex gap-3 justify-center mt-5">
            {wo.state === 'done' ? (
              <span className="text-green-600 font-semibold text-sm">Completed</span>
            ) : (
              <>
                <button onClick={handleToggle} disabled={!!actionLoading}
                  className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50 ${
                    running ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                  }`}>
                  {actionLoading === 'start' || actionLoading === 'pause' ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : running ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause</>
                  ) : (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 3l14 9-14 9V3z"/></svg>{timerSec > 0 ? 'Resume' : 'Start'}</>
                  )}
                </button>
                <button onClick={handleDoneRequest} disabled={!!actionLoading}
                  className="px-6 py-3 rounded-xl bg-green-500 text-white font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-50">
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

      {actionError && (
        <div className="px-4 mb-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">{actionError}</div>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-5 py-1 text-[13px] text-gray-500">Step {woIdx + 1} of {allWos.length}</div>

      <div className="px-4 mb-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          <button onClick={() => setTab('components')} className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${tab === 'components' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500'}`}>
            Ingredients ({pickedCount}/{totalComps})
          </button>
          <button onClick={() => setTab('instructions')} className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${tab === 'instructions' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-500'}`}>
            Instructions{hasInstructions ? ' *' : ''}
          </button>
        </div>
      </div>

      <div className="px-4 pb-40">
        {tab === 'components' && (
          <div className="flex flex-col gap-1.5">
            {totalComps > 0 && (
              <div className="flex items-center justify-between mb-1 px-1">
                <p className="text-[11px] text-gray-400">Tap to weigh each ingredient</p>
                {pickedCount === totalComps && totalComps > 0 && (
                  <span className="text-[11px] font-semibold text-green-600">All collected</span>
                )}
              </div>
            )}
            {totalComps > 0 && (
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${totalComps > 0 ? (pickedCount / totalComps) * 100 : 0}%` }} />
              </div>
            )}

            {displayComps.map((c: any) => {
              const consumed = c.consumed_qty || 0;
              const required = c.product_uom_qty || 0;
              const isPicked = c.picked === true;
              const compUom = c.product_uom?.[1] || 'kg';
              return (
                <button key={c.id} onClick={() => setNumpadComp(c)}
                  className={`bg-white border rounded-xl flex overflow-hidden text-left active:scale-[0.98] transition-all ${
                    isPicked ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
                  }`}>
                  <div className={`w-1 flex-shrink-0 ${isPicked ? 'bg-green-500' : 'bg-gray-200'}`} />
                  <div className="flex-1 flex items-center gap-3 px-4 py-3">
                    <div className={`w-7 h-7 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      isPicked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
                    }`}>
                      {isPicked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${isPicked ? 'text-green-700 line-through decoration-green-400' : 'text-gray-900'}`}>
                        {c.product_id[1]}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {isPicked
                          ? `${fmt(consumed)} / ${fmt(required)} ${compUom}`
                          : `Need ${fmt(required)} ${compUom}`
                        }
                      </div>
                      {isPicked && consumed !== required && Math.abs(consumed - required) > 0.001 && (
                        <div className={`text-[10px] mt-0.5 font-semibold ${
                          Math.abs(consumed - required) / required * 100 > tolerancePct
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }`}>
                          {consumed > required ? '+' : ''}{fmt(consumed - required)} {compUom} ({consumed > required ? '+' : ''}{((consumed - required) / required * 100).toFixed(1)}%)
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-[15px] font-bold tabular-nums font-mono ${isPicked ? 'text-green-600' : 'text-gray-400'}`}>
                        {isPicked ? fmt(consumed) : fmt(required)}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {isPicked ? `/ ${fmt(required)} ${compUom}` : compUom}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {displayComps.length === 0 && <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">No ingredients assigned to this step</div>}
          </div>
        )}

        {tab === 'instructions' && (
          <div className="flex flex-col gap-3">
            {hasPdf && (
              <button onClick={() => setShowPdf(true)}
                className="w-full bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 text-left active:bg-gray-50 active:scale-[0.98] transition-all">
                <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold text-gray-900">PDF Worksheet</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">Tap to view fullscreen</div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
              </button>
            )}

            {hasGoogleSlide && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    <span className="text-[13px] font-semibold text-gray-700">Google Slides</span>
                  </div>
                  <a href={worksheetGoogleSlide} target="_blank" rel="noopener noreferrer" className="text-[12px] text-green-700 font-semibold">Open in new tab</a>
                </div>
                <iframe src={worksheetGoogleSlide.replace('/edit', '/embed')} className="w-full border-0" style={{ height: '400px' }} title="Google Slides Worksheet" allowFullScreen />
              </div>
            )}

            {hasText && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {(hasPdf || hasGoogleSlide) && (
                  <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>
                    <span className="text-[13px] font-semibold text-gray-700">Description</span>
                  </div>
                )}
                <div
                  className="p-5 text-[14px] text-gray-800 leading-relaxed
                    [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2
                    [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2
                    [&_li]:my-1 [&_p]:my-2 [&_strong]:font-bold
                    [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2
                    [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5
                    [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-1"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(operationNote) }}
                />
              </div>
            )}

            {!hasInstructions && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-gray-400 text-sm">No instructions yet</p>
                <p className="text-gray-300 text-xs mt-1">Add in Odoo 18 EE: BOM {arrow} Operations {arrow} Work Sheet</p>
                <p className="text-gray-300 text-xs mt-0.5">Supports: Text, PDF, or Google Slides</p>
              </div>
            )}
          </div>
        )}
      </div>

      {wo.state !== 'done' && (
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 pb-4 pt-2 bg-gradient-to-t from-gray-50">
          <button onClick={handleDoneRequest} disabled={!!actionLoading}
            className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[15px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
            {actionLoading === 'done' ? 'Finishing...' : nextWo && nextWo.state !== 'done' ? `Done ${arrow} ${nextWo.name}` : 'Mark step done'}
          </button>
        </div>
      )}

      {numpadComp && (
        <Numpad
          label={numpadComp.product_id[1]}
          value={numpadComp.picked ? String(numpadComp.consumed_qty || 0) : '0'}
          unit={numpadComp.product_uom?.[1] || 'kg'}
          demandQty={numpadComp.product_uom_qty}
          tolerancePct={tolerancePct}
          loading={numpadSaving}
          onConfirm={handleNumpadConfirm}
          onClose={() => setNumpadComp(null)}
        />
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowConfirm(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-24" onClick={(e) => e.stopPropagation()} style={{animation: 'slideUp .25s ease-out'}}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <div className="text-center mb-6">
              <h3 className="text-lg font-bold text-gray-900">Finished this step?</h3>
              <p className="text-sm text-gray-500 mt-2">
                Marking <strong>{wo.name}</strong> as done{productName !== 'this product' && <> for <strong>{productName}</strong></>}.
                {running && <><br />Timer stops at <strong>{mm}:{ss}</strong>.</>}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm active:bg-gray-50">Not yet</button>
              <button onClick={handleDoneConfirmed} disabled={!!actionLoading}
                className="flex-1 py-3.5 rounded-xl bg-green-500 text-white font-bold text-sm shadow-lg shadow-green-500/30 active:scale-[0.975] transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
                {actionLoading === 'done' ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Yes, done'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPdf && hasPdf && (
        <PdfViewer fileData={worksheetPdf} fileName="worksheet.pdf" onClose={() => setShowPdf(false)} />
      )}
      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
