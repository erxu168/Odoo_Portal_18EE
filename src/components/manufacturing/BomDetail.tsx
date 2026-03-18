'use client';

import React, { useState, useEffect } from 'react';
import {
  BackHeader,
  StatusDot,
  SectionTitle,
  ActionButton,
  Badge,
} from './ui';
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

  useEffect(() => {
    fetchBomDetail();
  }, [bomId]);

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
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  if (loading || !bom) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading...
      </div>
    );
  }

  const productName = bom.product_tmpl_id[1];
  const uom = bom.product_uom_id[1];
  const lastProduced = bom.last_produced
    ? new Date(bom.last_produced).toLocaleDateString('de-DE', {
        month: 'short',
        day: 'numeric',
      })
    : 'Never';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <BackHeader
        backLabel="Recipes"
        backHref="#"
        title={productName}
        subtitle={`Makes ${new Intl.NumberFormat('de-DE').format(bom.product_qty)}${uom} per batch · Last produced ${lastProduced}`}
      />

      {/* Stats row */}
      <div className="flex gap-2 px-4 py-3">
        <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-gray-400">Components</div>
          <div className="text-lg font-medium text-gray-900 dark:text-white mt-0.5">
            {components.length}
          </div>
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-gray-400">On hand</div>
          <div className="text-lg font-medium text-gray-900 dark:text-white mt-0.5">
            --
          </div>
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-gray-400">Can make</div>
          <div className="text-lg font-medium text-emerald-600 mt-0.5">
            {new Intl.NumberFormat('de-DE').format(canMakeQty)}{uom}
          </div>
        </div>
      </div>

      <SectionTitle>Components</SectionTitle>

      {/* Component list */}
      <div className="px-4 pb-4 flex flex-col gap-1.5">
        {components.map((comp) => (
          <React.Fragment key={comp.product_id}>
            <div
              className={`bg-white dark:bg-gray-900 border rounded-lg px-3.5 py-3 flex justify-between items-center ${
                comp.is_sub_bom
                  ? 'border-blue-200 dark:border-blue-700 cursor-pointer'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
              onClick={() => comp.is_sub_bom && toggleSubBom(comp.product_id)}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <StatusDot status={comp.status} />
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-white truncate">
                    {comp.product_name}
                    {comp.is_sub_bom && (
                      <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        Sub-recipe
                      </span>
                    )}
                  </div>
                  {comp.is_sub_bom && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {expandedSubBoms.has(comp.product_id)
                        ? 'Tap to collapse'
                        : 'Tap to expand'}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {new Intl.NumberFormat('de-DE').format(comp.required_qty)}
                  {comp.uom}
                </div>
                <div
                  className={`text-[11px] mt-0.5 ${
                    comp.status === 'ok'
                      ? 'text-emerald-600'
                      : comp.status === 'low'
                      ? 'text-amber-600'
                      : 'text-red-600'
                  }`}
                >
                  {new Intl.NumberFormat('de-DE').format(comp.on_hand_qty)}{' '}
                  {comp.uom} on hand
                </div>
              </div>
            </div>

            {/* Expanded sub-BOM */}
            {comp.is_sub_bom &&
              expandedSubBoms.has(comp.product_id) &&
              comp.sub_bom_lines && (
                <div className="ml-5 border-l-2 border-blue-200 dark:border-blue-700">
                  <div className="ml-3 bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-700 rounded-lg overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <span className="text-[13px] font-medium text-blue-700 dark:text-blue-300">
                        {comp.product_name} (sub-BOM)
                      </span>
                      <span className="text-xs text-gray-400">
                        {comp.sub_bom_lines.length} items
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {comp.sub_bom_lines.map((sub) => (
                        <div
                          key={sub.product_id}
                          className="px-3.5 py-2 flex justify-between items-center"
                        >
                          <span className="text-[13px] text-gray-900 dark:text-white">
                            <StatusDot status={sub.status} />
                            {sub.product_name}
                          </span>
                          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-300">
                            {new Intl.NumberFormat('de-DE').format(
                              sub.required_qty,
                            )}
                            {sub.uom}
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

      {/* Action bar */}
      <div className="px-4 pb-6 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 pt-3">
        <ActionButton onClick={() => onCreateMo(bomId)}>
          Create manufacturing order
        </ActionButton>
      </div>
    </div>
  );
}
