'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  BackHeader,
  StatusDot,
  SectionTitle,
  ActionButton,
} from './ui';
import type { ComponentAvailability } from '@/types/manufacturing';

interface CreateMoProps {
  bomId: number;
  onBack: () => void;
  onCreated: (moId: number) => void;
}

export default function CreateMo({ bomId, onBack, onCreated }: CreateMoProps) {
  const [bom, setBom] = useState<any>(null);
  const [components, setComponents] = useState<ComponentAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [qty, setQty] = useState('');
  const [sqcEnabled, setSqcEnabled] = useState(false);
  const [drivingComponentId, setDrivingComponentId] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState(
    new Date().toISOString().split('T')[0],
  );

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
      // Default qty to BOM base
      setQty(String(data.bom?.product_qty || 0));
    } catch (err) {
      console.error('Failed to fetch BOM:', err);
    } finally {
      setLoading(false);
    }
  }

  // Calculate ratio and scaled components
  const numQty = parseFloat(qty) || 0;
  const baseQty = bom?.product_qty || 1;
  const ratio = baseQty > 0 ? numQty / baseQty : 0;

  const scaledComponents = useMemo(() => {
    return components.map((c) => {
      const scaled = Math.round(c.required_qty * ratio * 1000) / 1000;
      const short = scaled - c.on_hand_qty;
      return {
        ...c,
        scaled_qty: scaled,
        is_short: short > 0,
        short_amount: Math.max(0, Math.round(short * 1000) / 1000),
      };
    });
  }, [components, ratio]);

  // Find the bottleneck component
  const maxProducible = useMemo(() => {
    if (!components.length || baseQty <= 0) return 0;
    let minQty = Infinity;
    for (const c of components) {
      if (c.required_qty > 0) {
        const maxFromThis = (c.on_hand_qty / c.required_qty) * baseQty;
        minQty = Math.min(minQty, maxFromThis);
      }
    }
    return minQty === Infinity ? 0 : Math.floor(minQty);
  }, [components, baseQty]);

  // Shortcut amounts (0.5x, 1x, 1.5x, 2x, 3x of base)
  const shortcuts = useMemo(() => {
    if (!baseQty) return [];
    return [0.5, 1, 1.5, 2, 3].map((m) => ({
      label: `${new Intl.NumberFormat('de-DE').format(Math.round(baseQty * m))}`,
      value: Math.round(baseQty * m),
    }));
  }, [baseQty]);

  // Set qty by component logic
  const drivingComponent = useMemo(() => {
    if (!sqcEnabled || !drivingComponentId) return null;
    return components.find((c) => c.product_id === drivingComponentId) || null;
  }, [sqcEnabled, drivingComponentId, components]);

  useEffect(() => {
    if (sqcEnabled && drivingComponent) {
      // Calculate output qty from driving component's available stock
      const drivingRatio =
        drivingComponent.required_qty > 0
          ? drivingComponent.on_hand_qty / drivingComponent.required_qty
          : 0;
      const autoQty = Math.floor(drivingRatio * baseQty);
      setQty(String(autoQty));
    }
  }, [sqcEnabled, drivingComponent, baseQty]);

  // Auto-select the bottleneck as driving component when SQC is toggled on
  useEffect(() => {
    if (sqcEnabled && !drivingComponentId && components.length) {
      let minRatio = Infinity;
      let bottleneckId: number | null = null;
      for (const c of components) {
        if (c.required_qty > 0) {
          const r = c.on_hand_qty / c.required_qty;
          if (r < minRatio) {
            minRatio = r;
            bottleneckId = c.product_id;
          }
        }
      }
      if (bottleneckId) setDrivingComponentId(bottleneckId);
    }
  }, [sqcEnabled, components, drivingComponentId]);

  const shortComponents = scaledComponents.filter((c) => c.is_short);
  const uom = bom?.product_uom_id?.[1] || 'g';

  async function handleSubmit(asDraft: boolean = false) {
    if (!bom || numQty <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/manufacturing-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: bom.product_id?.[0] || bom.product_tmpl_id[0],
          bom_id: bom.id,
          product_qty: numQty,
          product_uom_id: bom.product_uom_id[0],
          date_deadline: scheduledDate,
        }),
      });
      const data = await res.json();
      if (data.id) {
        if (!asDraft) {
          // Confirm the MO
          await fetch(`/api/manufacturing-orders/${data.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm' }),
          });
        }
        onCreated(data.id);
      }
    } catch (err) {
      console.error('Failed to create MO:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !bom) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <BackHeader
        backLabel={bom.product_tmpl_id[1]}
        backHref="#"
        title="New manufacturing order"
      />

      <div className="pt-2">
        {/* Product (read-only) */}
        <div className="px-5 pb-3">
          <label className="text-[13px] text-gray-500 mb-1.5 block">
            Product
          </label>
          <div className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-white">
            {bom.product_tmpl_id[1]}
          </div>
        </div>

        {/* SQC Toggle */}
        <div className="mx-4 mb-3 flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
          <div>
            <div className="text-[13px] text-gray-900 dark:text-white">
              Set qty by component
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Auto-calculate output from ingredient stock
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSqcEnabled(!sqcEnabled);
              if (sqcEnabled) {
                // Reset to base qty when turning off
                setQty(String(baseQty));
              }
            }}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              sqcEnabled
                ? 'bg-blue-500'
                : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                sqcEnabled ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Driving component selector (visible when SQC on) */}
        {sqcEnabled && (
          <div className="px-5 pb-3">
            <label className="text-[13px] text-gray-500 mb-1.5 block">
              Driving component
            </label>
            <select
              value={drivingComponentId || ''}
              onChange={(e) =>
                setDrivingComponentId(parseInt(e.target.value) || null)
              }
              className="w-full px-3.5 py-2.5 rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-sm font-medium text-blue-700 dark:text-blue-300"
            >
              <option value="">Select component...</option>
              {components.map((c) => (
                <option key={c.product_id} value={c.product_id}>
                  {c.product_name} · {new Intl.NumberFormat('de-DE').format(c.on_hand_qty)}
                  {c.uom} available
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quantity input */}
        <div className="px-5 pb-1">
          <label className="text-[13px] text-gray-500 mb-1.5 block">
            Quantity to produce{sqcEnabled ? ' (auto-calculated)' : ''}
          </label>
        </div>
        <div className="mx-5 mb-1.5 flex items-center border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            readOnly={sqcEnabled}
            className={`flex-1 px-3.5 py-3 text-[22px] font-medium border-none bg-transparent focus:outline-none ${
              sqcEnabled
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-900 dark:text-white'
            }`}
          />
          <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 dark:bg-gray-700 border-l border-gray-200 dark:border-gray-700">
            {uom}
          </div>
        </div>
        <div className="px-5 pb-2.5 text-xs text-gray-400">
          BOM base: {new Intl.NumberFormat('de-DE').format(baseQty)}{uom} ·
          Ratio: {ratio.toFixed(2)}x
          {sqcEnabled && drivingComponent
            ? ` · Limited by ${drivingComponent.product_name}`
            : ''}
        </div>

        {/* Shortcut chips (hidden when SQC is on) */}
        {!sqcEnabled && (
          <div className="flex gap-2 px-5 pb-3.5 flex-wrap">
            {shortcuts.map((s) => (
              <button
                key={s.value}
                onClick={() => setQty(String(s.value))}
                className={`px-3.5 py-1.5 rounded-full text-xs border transition-colors ${
                  numQty === s.value
                    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
                    : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'
                }`}
              >
                {s.label}{uom}
              </button>
            ))}
          </div>
        )}

        {/* Date and responsible */}
        <div className="px-5 pb-3 flex gap-3">
          <div className="flex-1">
            <label className="text-[13px] text-gray-500 mb-1.5 block">
              Date
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <label className="text-[13px] text-gray-500 mb-1.5 block">
              Responsible
            </label>
            <div className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white">
              Ethan
            </div>
          </div>
        </div>

        {/* Scaled components */}
        <SectionTitle>
          Scaled components ({new Intl.NumberFormat('de-DE').format(numQty)}{uom})
        </SectionTitle>
        <div className="px-4 pb-3 flex flex-col gap-1">
          {scaledComponents.map((c) => (
            <div
              key={c.product_id}
              className={`bg-white dark:bg-gray-900 border rounded-lg px-3.5 py-2.5 flex justify-between items-center ${
                sqcEnabled && c.product_id === drivingComponentId
                  ? 'border-blue-200 dark:border-blue-700'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="text-[13px] text-gray-900 dark:text-white">
                <StatusDot status={c.is_short ? 'out' : c.status} />
                {c.product_name}
                {sqcEnabled && c.product_id === drivingComponentId && (
                  <span className="text-[11px] text-blue-600 dark:text-blue-400 ml-1">
                    (driving)
                  </span>
                )}
              </span>
              <div className="flex gap-4 items-baseline">
                <span
                  className={`text-[13px] font-medium ${
                    c.is_short ? 'text-red-600' : 'text-gray-900 dark:text-white'
                  }`}
                >
                  {new Intl.NumberFormat('de-DE').format(c.scaled_qty)}{c.uom}
                </span>
                <span
                  className={`text-xs ${
                    c.is_short
                      ? 'text-red-500'
                      : sqcEnabled && c.product_id === drivingComponentId
                      ? 'text-blue-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {new Intl.NumberFormat('de-DE').format(c.on_hand_qty)}{' '}
                  {c.uom} avail
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Shortage warning */}
        {shortComponents.length > 0 && (
          <div className="mx-4 mt-1 mb-2 px-3.5 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-[13px] text-amber-700 dark:text-amber-300">
            {shortComponents.map((c) => c.product_name).join(', ')}:{' '}
            short for {new Intl.NumberFormat('de-DE').format(numQty)}{uom}.
            Max producible: {new Intl.NumberFormat('de-DE').format(maxProducible)}{uom}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-4 pb-6 pt-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
        <ActionButton
          onClick={() => handleSubmit(false)}
          disabled={submitting || numQty <= 0}
        >
          {submitting
            ? 'Creating...'
            : `Confirm order (${new Intl.NumberFormat('de-DE').format(numQty)}${uom})`}
        </ActionButton>
        <div className="mt-2">
          <ActionButton
            variant="outline"
            onClick={() => handleSubmit(true)}
            disabled={submitting || numQty <= 0}
          >
            Save as draft
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
