'use client';

import React, { useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';

interface GuideLine {
  id: number;
  productId: number;
  productName: string;
  defaultQty: number;
  uom: string;
  priceUnit: number;
  qty: number; // local state — what user has entered
}

interface GuideDetail {
  id: number;
  name: string;
  supplier: {
    id: number;
    name: string;
    minOrderValue: number;
  } | null;
  lines: GuideLine[];
}

interface Props {
  guideId: number;
  supplierId: number;
  onBack: () => void;
}

/**
 * GuideOrder — Product list for a supplier's order guide
 *
 * Shows all products with +/- steppers and tappable qty (numpad TODO).
 * Min order value progress bar at bottom.
 * "Review Order" button when items selected.
 */
export default function GuideOrder({ guideId, onBack }: Props) {
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`/api/purchase/guides/${guideId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const lines = (data.lines || []).map((l: any) => ({
          ...l,
          qty: l.defaultQty || 0,
        }));
        setGuide({ ...data, lines });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [guideId]);

  function updateQty(lineId: number, delta: number) {
    if (!guide) return;
    setGuide({
      ...guide,
      lines: guide.lines.map((l) =>
        l.id === lineId ? { ...l, qty: Math.max(0, l.qty + delta) } : l
      ),
    });
  }

  function setQty(lineId: number, qty: number) {
    if (!guide) return;
    setGuide({
      ...guide,
      lines: guide.lines.map((l) =>
        l.id === lineId ? { ...l, qty: Math.max(0, qty) } : l
      ),
    });
  }

  const orderTotal = guide
    ? guide.lines.reduce((sum, l) => sum + l.qty * l.priceUnit, 0)
    : 0;
  const itemCount = guide
    ? guide.lines.filter((l) => l.qty > 0).length
    : 0;
  const minOrder = guide?.supplier?.minOrderValue || 0;
  const minMet = minOrder <= 0 || orderTotal >= minOrder;
  const minPct = minOrder > 0 ? Math.min(100, Math.round((orderTotal / minOrder) * 100)) : 100;

  const filtered = guide && search
    ? guide.lines.filter((l) =>
        l.productName.toLowerCase().includes(search.toLowerCase())
      )
    : guide?.lines || [];

  if (loading) {
    return (
      <div className="px-4 py-8 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`${ds.skeleton} h-16`} />
        ))}
      </div>
    );
  }

  if (error || !guide) {
    return (
      <div className={ds.emptyState}>
        <div className={ds.emptyIcon}>⚠️</div>
        <div className={ds.emptyTitle}>Failed to load guide</div>
        <div className={ds.emptyBody}>{error}</div>
        <button onClick={onBack} className={`${ds.btnGhost} mt-4`}>← Go back</button>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className={ds.topbar}>
        <button onClick={onBack} className={ds.btnBack}>
          ← Back
        </button>
        <div className="text-right">
          <div className={ds.topbarTitle}>{guide.supplier?.name || guide.name}</div>
          <div className={ds.topbarSub}>
            {guide.lines.length} products{minOrder > 0 ? ` · Min. €${minOrder}` : ''}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <input
          className={ds.input}
          placeholder="Filter products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Product list */}
      <div className={ds.scrollArea}>
        {filtered.map((line) => (
          <div
            key={line.id}
            className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-base flex-shrink-0">
              🛒
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-gray-900 truncate">
                {line.productName}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                €{line.priceUnit.toFixed(2)}/{line.uom}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => updateQty(line.id, -1)}
                className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] font-semibold text-gray-700 active:bg-gray-100"
              >
                −
              </button>
              <button
                onClick={() => {
                  const val = prompt(`Qty for ${line.productName}:`, String(line.qty));
                  if (val !== null) setQty(line.id, parseFloat(val) || 0);
                }}
                className={`w-10 text-center text-[16px] font-bold font-mono ${
                  line.qty > 0 ? 'text-krawings-600' : 'text-gray-300'
                }`}
              >
                {line.qty}
              </button>
              <button
                onClick={() => updateQty(line.id, 1)}
                className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] font-semibold text-gray-700 active:bg-gray-100"
              >
                +
              </button>
            </div>
          </div>
        ))}

        {/* Min order bar */}
        {minOrder > 0 && (
          <div
            className={`mx-4 mt-4 p-3 rounded-xl border ${
              minMet
                ? 'bg-green-50 border-green-200'
                : 'bg-amber-50 border-amber-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{minMet ? '✓' : '⚠'}</span>
              <div className="flex-1">
                <div
                  className={`text-[12px] font-semibold ${
                    minMet ? 'text-green-700' : 'text-amber-700'
                  }`}
                >
                  {minMet
                    ? 'Minimum order reached'
                    : `Below minimum (€${minOrder})`}
                </div>
                <div className="text-[11px] text-gray-600 mt-0.5">
                  Current: €{orderTotal.toFixed(2)}
                  {!minMet && ` · Need €${(minOrder - orderTotal).toFixed(2)} more`}
                </div>
                <div className="h-1 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      minMet ? 'bg-green-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${minPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Review button */}
        <div className="px-4 py-4">
          <button
            className={ds.btnPrimary}
            disabled={itemCount === 0}
          >
            Review Order · {itemCount} item{itemCount !== 1 ? 's' : ''} · €{orderTotal.toFixed(2)}
          </button>
        </div>

        <div className="h-20" />
      </div>
    </>
  );
}
