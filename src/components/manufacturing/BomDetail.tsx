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
  const [expandedSubBoms, setExpandedSubBoms] = useState<Set<number>>(new Set());

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBomDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/boms/${bomId}`);
      const data = await res.json();
      setBom(data.bom);
      setComponents(data.components || []);
      setCanMakeQty(data.can_make_qty || 0);
    } catch (err) {
      console.error('Failed to fetch BOM detail:', err);
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

  if (loading || !bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
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
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-2 text-orange-600 text-[13px] font-semibold active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Recipes
        </button>
        <h1 className="text-[18px] font-bold text-gray-900">{productName}</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Makes {new Intl.NumberFormat('de-DE').format(bom.product_qty)}{uom} per batch &middot; Last produced {lastProduced}
        </p>
      </div>

      {/* Stats strip */}
      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">INGREDIENTS</div>
            <div className="text-lg font-bold text-orange-500 mt-0.5 font-mono">{components.length}</div>
          </div>
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">ON HAND</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5 font-mono">&mdash;</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[11px] text-gray-400 font-semibold tracking-wider">CAN MAKE</div>
            <div className="text-lg font-bold text-emerald-500 mt-0.5 font-mono">
              {new Intl.NumberFormat('de-DE').format(canMakeQty)}{uom}
            </div>
          </div>
        </div>
      </div>

      {/* Section title */}
      <div className="px-5 pt-1 pb-2">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">Ingredients</p>
      </div>

      {/* Component list */}
      <div className="px-4 pb-28 flex flex-col gap-1.5">
        {components.map((comp) => (
          <React.Fragment key={comp.product_id}>
            <button
              onClick={() => comp.is_sub_bom && toggleSubBom(comp.product_id)}
              className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center text-left w-full ${
                comp.is_sub_bom ? 'border-orange-200 active:scale-[0.98] transition-transform' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <StatusDot status={comp.status} />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-gray-900 truncate">
                    {comp.product_name}
                    {comp.is_sub_bom && (
                      <span className="ml-2 text-[10px] px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 font-semibold">Sub-recipe</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <div className="text-[14px] font-bold text-gray-900 tabular-nums font-mono">
                  {new Intl.NumberFormat('de-DE').format(comp.required_qty)}{comp.uom}
                </div>
                <div className={`text-[11px] mt-0.5 ${
                  comp.status === 'ok' ? 'text-emerald-600' : comp.status === 'low' ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {new Intl.NumberFormat('de-DE').format(comp.on_hand_qty)} {comp.uom} on hand
                </div>
              </div>
            </button>

            {comp.is_sub_bom && expandedSubBoms.has(comp.product_id) && comp.sub_bom_lines && (
              <div className="ml-5 border-l-2 border-orange-200">
                <div className="ml-3 bg-white border border-orange-200 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-gray-100 flex justify-between items-center">
                    <span className="text-[13px] font-semibold text-orange-700">{comp.product_name} (sub-recipe)</span>
                    <span className="text-[11px] text-gray-400">{comp.sub_bom_lines.length} items</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {comp.sub_bom_lines.map((sub) => (
                      <div key={sub.product_id} className="px-3.5 py-2.5 flex justify-between items-center">
                        <span className="text-[13px] text-gray-900 flex items-center gap-1.5">
                          <StatusDot status={sub.status} />{sub.product_name}
                        </span>
                        <span className="text-[13px] font-bold text-gray-700 font-mono">
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

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
        <button
          onClick={() => onCreateMo(bomId)}
          className="w-full py-4 rounded-xl bg-orange-500 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-transform"
        >
          Create manufacturing order
        </button>
      </div>
    </div>
  );
}
