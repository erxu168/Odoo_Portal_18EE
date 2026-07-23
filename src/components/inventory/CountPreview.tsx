'use client';

import React, { useState, useMemo } from 'react';
import GuidedCountingFlow from './GuidedCountingFlow';
import { ProductThumb } from './ui';
import { buildGuidedRoute } from '@/lib/guided-route';

/**
 * "Preview as staff" — renders the REAL staff counting flow (GuidedCountingFlow)
 * in read-only mode, so a manager building a list sees EXACTLY what their team
 * will walk through: the route checklist, each location's screen + photo, the
 * products at each stop, and the skip flow. Nothing is saved — the per-stop
 * done/skip status lives in local state only.
 *
 * It reuses buildGuidedRoute (the same engine the real session freezes) and the
 * same GuidedCountingFlow staff use, so the preview can never disagree with the
 * actual count. (Design principle: a preview reuses the real logic, never a copy.)
 */
interface PreviewProps {
  listName: string;
  /** The list's products, in session order (Array.from(selectedProductIds)). */
  productIds: number[];
  placements: { odoo_product_id: number; count_location_id: number; shelf_sort: number }[];
  /** Count-location metas (RouteLocationMeta[]) — id, parent_id, name, kind, photo, description, sort_order. */
  locations: any[];
  productsById: Record<number, any>;
  productImageIds: Set<number>;
  unitHint: (p: any) => string;
  onClose: () => void;
}

export default function CountPreview({
  listName, productIds, placements, locations, productsById, productImageIds, unitHint, onClose,
}: PreviewProps) {
  // Local, unsaved: tapping Finish/Skip walks the manager through the flow.
  const [statuses, setStatuses] = useState<Record<number, { status: string; skip_reason: string | null }>>({});
  const [reviewing, setReviewing] = useState(false);

  const { guided, stops } = useMemo(
    () => buildGuidedRoute({ productIds, placements, locations, statuses: [] }),
    [productIds, placements, locations],
  );
  const withProducts = stops.filter((s) => s.product_ids.length > 0);

  // The read-only staff count row: same shape staff see (thumb, name, unit) with
  // a non-interactive "Count →" placeholder standing in for the entry control.
  function previewRow(p: { id: number; name: string }) {
    const full = productsById[p.id] || p;
    return (
      <div className="py-3 border-b border-gray-100 flex items-center gap-3">
        <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={48} />
        <div className="flex-1 min-w-0">
          <div className="text-[var(--fs-xxl)] font-semibold text-gray-900 truncate">{p.name}</div>
          <div className="text-[var(--fs-xs)] text-gray-400 truncate">{unitHint(full)}</div>
        </div>
        <div className="flex-shrink-0 text-right border border-dashed border-gray-300 rounded-xl px-3 py-2 min-w-[92px] text-[var(--fs-sm)] font-bold text-gray-400">
          Count {'→'}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[130] bg-gray-50 flex flex-col">
      <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex-shrink-0">Preview</span>
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">How staff see it</h3>
          </div>
          <p className="text-[var(--fs-xs)] text-gray-500 truncate">{listName || 'This list'} {'·'} nothing you tap here is saved</p>
        </div>
        <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70 flex-shrink-0 ml-3">Close</button>
      </div>

      {withProducts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center text-gray-400">
          <p className="text-[var(--fs-base)] font-semibold text-gray-500 mb-1">Nothing to preview yet</p>
          <p className="text-[var(--fs-sm)]">Add products to the list first.</p>
        </div>
      ) : reviewing ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-3">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </div>
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">That{'’'}s the whole count</p>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-5 max-w-[260px]">This is exactly what your staff walk through. Nothing here was saved {'—'} it was only a preview.</p>
          <button onClick={onClose} className="px-6 py-3 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Done</button>
        </div>
      ) : !guided ? (
        // No valid locations → staff get the flat list, NOT the guided walk.
        // Mirror that here so the preview never shows a wizard they won't see.
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="text-[var(--fs-xs)] text-gray-500 mb-3 text-center">No locations set for these products {'—'} staff count them from one simple list.</p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {productIds.map((id) => productsById[id]).filter(Boolean).map((p: any) => (
              <div key={p.id}>{previewRow(p)}</div>
            ))}
          </div>
        </div>
      ) : (
        <GuidedCountingFlow
          stops={stops}
          productsById={productsById}
          statuses={statuses}
          renderRow={(p) => previewRow(p)}
          onFinishStop={(b) => setStatuses((s) => ({ ...s, [b]: { status: 'counted', skip_reason: null } }))}
          onSkipStop={(b, r) => setStatuses((s) => ({ ...s, [b]: { status: 'skipped', skip_reason: r } }))}
          onReview={() => setReviewing(true)}
        />
      )}
    </div>
  );
}
