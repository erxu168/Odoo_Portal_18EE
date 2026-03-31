'use client';

import React, { useState, useEffect } from 'react';
import { StatusDot } from './ui';
import type { ComponentAvailability } from '@/types/manufacturing';

interface BomDetailProps {
  bomId: number;
  onBack: () => void;
  onCreateMo: (bomId: number) => void;
}

export default function BomDetail({ bomId, onBack, onCreateMo }: BomDetailProps) {
  const [bom, setBom] = useState<any>(null);
  const [components, setComponents] = useState<ComponentAvailability[]>([]);
  const [canMakeQty, setCanMakeQty] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubBoms, setExpandedSubBoms] = useState<Set<number>>(new Set());

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBomDetail() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boms/${bomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBom(data.bom);
      setComponents(data.components || []);
      setCanMakeQty(data.can_make_qty || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load recipe details');
    } finally {
      setLoading(false);
    }
  }

  function toggleSubBom(productId: number) {
    setExpandedSubBoms((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load recipe</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5">{error || 'Recipe not found'}</p>
          <button onClick={fetchBomDetail} className="px-6 py-3 bg-green-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-green-600/30 active:scale-95 transition-transform">Retry</button>
          <button onClick={onBack} className="block mx-auto mt-3 text-[var(--fs-xs)] text-gray-500 active:opacity-70">Go back</button>
        </div>
      </div>
    );
  }

  const productName = bom.product_tmpl_id[1];
  const uom = bom.product_uom_id[1];
  const lastProduced = bom.last_produced
    ? new Date(bom.last_produced).toLocaleDateString('de-DE', { month: 'short', day: 'numeric' })
    : 'Never';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-2 text-green-700 text-[var(--fs-xs)] font-semibold active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Recipes
        </button>
        <h1 className="text-[var(--fs-lg)] font-bold text-gray-900">{productName}</h1>
        <p className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
          Makes {new Intl.NumberFormat('de-DE').format(bom.product_qty)}{uom} per batch &middot; Last produced {lastProduced}
        </p>
      </div>

      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">INGREDIENTS</div>
            <div className="text-lg font-bold text-green-600 mt-0.5 font-mono">{components.length}</div>
          </div>
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">ON HAND</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5 font-mono">&mdash;</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">CAN MAKE</div>
            <div className="text-lg font-bold text-green-500 mt-0.5 font-mono">
              {new Intl.NumberFormat('de-DE').format(canMakeQty)}{uom}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pt-1 pb-2">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">Ingredients</p>
      </div>

      <div className="px-4 pb-44 flex flex-col gap-1.5">
        {(() => {
          const cats = Array.from(new Set(components.map((c: any) => c.category || 'Other')));
          return cats.map(cat => {
            const catComps = components.filter((c: any) => (c.category || 'Other') === cat);
            return (
              <div key={cat} className="mb-4">
                <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-2 flex justify-between">
                  <span>{cat}</span>
                  <span className="font-mono text-gray-300">{catComps.length}</span>
                </div>
                {catComps.map((comp) => (
          <React.Fragment key={comp.product_id}>
            <button
              onClick={() => comp.is_sub_bom && toggleSubBom(comp.product_id)}
              className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center text-left w-full mb-1.5 ${
                comp.is_sub_bom ? 'border-green-200 active:scale-[0.98] transition-transform' : 'border-gray-200'
              }`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <StatusDot status={comp.status} />
                <div className="min-w-0">
                  <div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">
                    {comp.product_name}
                    {comp.is_sub_bom && <span className="ml-2 text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-green-50 text-green-800 font-semibold">Sub-recipe</span>}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <div className="text-[var(--fs-lg)] font-bold text-gray-900 tabular-nums font-mono">
                  {new Intl.NumberFormat('de-DE').format(comp.required_qty)}{comp.uom}
                </div>
                <div className={`text-[var(--fs-xs)] mt-0.5 ${
                  comp.status === 'ok' ? 'text-green-600' : comp.status === 'low' ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {new Intl.NumberFormat('de-DE').format(comp.on_hand_qty)} {comp.uom} on hand
                </div>
              </div>
            </button>

            {comp.is_sub_bom && expandedSubBoms.has(comp.product_id) && comp.sub_bom_lines && (
              <div className="ml-5 border-l-2 border-green-200">
                <div className="ml-3 bg-white border border-green-200 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-gray-100 flex justify-between items-center">
                    <span className="text-[var(--fs-xs)] font-semibold text-green-800">{comp.product_name} (sub-recipe)</span>
                    <span className="text-[var(--fs-xs)] text-gray-400">{comp.sub_bom_lines.length} items</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {comp.sub_bom_lines.map((sub) => (
                      <div key={sub.product_id} className="px-3.5 py-2.5 flex justify-between items-center">
                        <span className="text-[15px] text-gray-900 flex items-center gap-1.5">
                          <StatusDot status={sub.status} />{sub.product_name}
                        </span>
                        <span className="text-[15px] font-bold text-gray-700 font-mono">
                          {new Intl.NumberFormat('de-DE').format(sub.required_qty)}{sub.uom}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
                ))}
              </div>
            );
          });
        })()}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 pb-4 pt-2 bg-gradient-to-t from-gray-50">
        <button onClick={() => onCreateMo(bomId)}
          className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-md)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform">
          Create manufacturing order
        </button>
      </div>
    </div>
  );
}
