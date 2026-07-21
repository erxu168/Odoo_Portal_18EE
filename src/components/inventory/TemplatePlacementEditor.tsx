'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BackHeader, Spinner, ProductThumb } from './ui';

/**
 * "Arrange spots" — where each product of ONE counting list is physically
 * counted. Spot cards in walking order; the same product may be added to
 * several spots (each becomes its own count line, summed on approval);
 * anything unplaced counts at "General". Saving affects FUTURE counts; an
 * untouched pending count for today can take the new layout immediately.
 */
export default function TemplatePlacementEditor({ templateId, templateName, onBack }: {
  templateId: number; templateName: string; onBack: () => void;
}) {
  const [spots, setSpots] = useState<any[]>([]);
  const [productIds, setProductIds] = useState<number[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [placements, setPlacements] = useState<{ odoo_product_id: number; count_location_id: number }[]>([]);
  const [todayUntouched, setTodayUntouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);   // spot id an "add products" sheet is open for
  const [applyToday, setApplyToday] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await fetch(`/api/inventory/templates/${templateId}/placements`).then((r) => r.json());
        if (d.error) { setError(d.error); return; }
        setSpots(d.spots || []);
        setProductIds(d.product_ids || []);
        setPlacements((d.placements || []).map((p: any) => ({ odoo_product_id: p.odoo_product_id, count_location_id: p.count_location_id })));
        setTodayUntouched(!!d.today_session_untouched);
        if ((d.product_ids || []).length > 0) {
          const pd = await fetch(`/api/inventory/products?ids=${d.product_ids.join(',')}&limit=1000`).then((r) => r.json());
          setProducts(pd.products || []);
        }
      } catch { setError('Could not load the spot layout.'); }
      finally { setLoading(false); }
    })();
  }, [templateId]);

  const byId = useMemo(() => { const m: Record<number, any> = {}; products.forEach((p) => { m[p.id] = p; }); return m; }, [products]);
  const atSpot = (sid: number) => placements.filter((p) => p.count_location_id === sid).map((p) => p.odoo_product_id);
  const spotsOf = (pid: number) => placements.filter((p) => p.odoo_product_id === pid).map((p) => p.count_location_id);
  const unplaced = productIds.filter((pid) => spotsOf(pid).length === 0);

  function toggle(pid: number, sid: number) {
    setPlacements((prev) => {
      const has = prev.some((p) => p.odoo_product_id === pid && p.count_location_id === sid);
      if (has) return prev.filter((p) => !(p.odoo_product_id === pid && p.count_location_id === sid));
      return [...prev, { odoo_product_id: pid, count_location_id: sid }];
    });
  }

  async function save() {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const res = await fetch(`/api/inventory/templates/${templateId}/placements`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placements: placements.map((p, i) => ({ ...p, shelf_sort: i })),
          apply_today: applyToday && todayUntouched,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not save.'); return; }
      setTodayUntouched(!!d.today_session_untouched);
      setSavedMsg(d.applied_today ? 'Saved — today’s count now uses this layout.' : 'Saved — applies from the next count.');
    } catch { setError('Network error — not saved.'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><Spinner /></div>;

  const spotName = (sid: number) => spots.find((s) => s.id === sid)?.name || `Spot ${sid}`;

  function SpotCard({ sid, title, items, addable }: { sid: number; title: React.ReactNode; items: number[]; addable: boolean }) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-3">
        <div className="flex items-center justify-between px-4 py-2.5 bg-green-50 border-b border-gray-100">
          <span className="text-[var(--fs-sm)] font-bold text-green-800">{title}</span>
          <span className="text-[var(--fs-xs)] text-gray-400 font-semibold">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        </div>
        {items.map((pid) => {
          const p = byId[pid] || { id: pid, name: `#${pid}` };
          const elsewhere = spotsOf(pid).filter((x) => x !== sid);
          return (
            <div key={pid} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-b-0">
              <ProductThumb productId={pid} has={false} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                {elsewhere.length > 0 && (
                  <div className="text-[var(--fs-xs)] text-blue-700">also at {elsewhere.map(spotName).join(', ')}</div>
                )}
              </div>
              {addable && (
                <button onClick={() => toggle(pid, sid)} aria-label={`Remove ${p.name}`}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          );
        })}
        {addable && (
          <button onClick={() => setAdding(sid)}
            className="w-full text-left px-4 py-2.5 text-[var(--fs-sm)] font-bold text-green-700 active:bg-green-50">
            + Add products here
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack} title={`Arrange spots`}
        subtitle={`${templateName} · ${productIds.length} products · ${placements.length + unplaced.length} count lines${unplaced.length ? ` · ${unplaced.length} not placed` : ''}`} />

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
        {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)] font-semibold">{error}</div>}
        {savedMsg && <div className="mb-3 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-green-800 text-[var(--fs-sm)] font-semibold">{savedMsg}</div>}

        {spots.length === 0 && (
          <div className="mb-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[var(--fs-sm)] font-semibold">
            No spots yet — create them under Inventory {'→'} Locations first.
          </div>
        )}

        {spots.map((s) => <SpotCard key={s.id} sid={s.id} title={s.name} items={atSpot(s.id)} addable />)}
        <SpotCard sid={0} title={<span className="text-gray-500">General (no specific spot)</span>} items={unplaced} addable={false} />

        <p className="text-[var(--fs-xs)] text-gray-400 mt-1 leading-snug">
          A product can be in several spots — staff count each spot separately and the app adds them up.
          Unplaced products are counted under {'“'}General{'”'}. Changes apply to future counts.
        </p>

        {todayUntouched && (
          <label className="mt-3 flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <input type="checkbox" checked={applyToday} onChange={(e) => setApplyToday(e.target.checked)} className="w-5 h-5 accent-green-600" />
            <span className="text-[var(--fs-sm)] font-semibold text-amber-800">
              Today{'’'}s count hasn{'’'}t been started — apply this layout to it too.
            </span>
          </label>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 bg-gray-50">
        <button onClick={save} disabled={saving}
          className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-xl)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save spot layout'}
        </button>
      </div>

      {adding != null && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center" onClick={() => setAdding(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8 max-h-[75vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">Add to {spotName(adding)}</h3>
            {productIds.map((pid) => {
              const p = byId[pid] || { id: pid, name: `#${pid}` };
              const here = spotsOf(pid).includes(adding);
              return (
                <button key={pid} onClick={() => toggle(pid, adding)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1.5 border text-left ${here ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200 active:bg-gray-50'}`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${here ? 'bg-green-600 border-green-600' : 'border-gray-300'}`}>
                    {here && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                  </div>
                  <span className="flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold text-gray-900">{p.name}</span>
                  {spotsOf(pid).filter((x) => x !== adding).length > 0 && (
                    <span className="text-[var(--fs-xs)] text-blue-700 flex-shrink-0">also elsewhere</span>
                  )}
                </button>
              );
            })}
            <button onClick={() => setAdding(null)} className="w-full py-3.5 rounded-xl bg-green-600 text-white font-bold mt-2">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
