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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  // Form state
  const [qty, setQty] = useState('');
  const [sqcEnabled, setSqcEnabled] = useState(false);
  const [drivingComponentId, setDrivingComponentId] = useState<number | null>(null);
  const [drivingComponentQty, setDrivingComponentQty] = useState('');
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

  // Shortcut amounts
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

  // When the user types a manual component qty, recalculate the output
  useEffect(() => {
    if (sqcEnabled && drivingComponent) {
      const manualQty = parseFloat(drivingComponentQty);
      if (!isNaN(manualQty) && manualQty > 0 && drivingComponent.required_qty > 0) {
        const outputQty = (manualQty / drivingComponent.required_qty) * baseQty;
        setQty(String(Math.round(outputQty * 100) / 100));
      } else if (!drivingComponentQty) {
        // If field is empty, use stock-based calculation
        const drivingRatio =
          drivingComponent.required_qty > 0
            ? drivingComponent.on_hand_qty / drivingComponent.required_qty
            : 0;
        const autoQty = Math.floor(drivingRatio * baseQty);
        setQty(String(autoQty));
      }
    }
  }, [sqcEnabled, drivingComponent, drivingComponentQty, baseQty]);

  // Auto-select the first component as driving when SQC toggled on
  useEffect(() => {
    if (sqcEnabled && !drivingComponentId && components.length) {
      setDrivingComponentId(components[0].product_id);
    }
  }, [sqcEnabled, components, drivingComponentId]);

  const shortComponents = scaledComponents.filter((c) => c.is_short);
  const uom = bom?.product_uom_id?.[1] || 'kg';

  async function handleConfirm() {
    if (!bom || numQty <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
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
      if (data.error) throw new Error(data.error);
      if (!data.id) throw new Error('No MO ID returned');

      // Confirm the MO
      const confirmRes = await fetch(`/api/manufacturing-orders/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      const confirmData = await confirmRes.json();
      if (confirmData.error) throw new Error(confirmData.error);

      onCreated(data.id);
    } catch (err: any) {
      console.error('Failed to create/confirm MO:', err);
      setSubmitError(err.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    if (!bom || numQty <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
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
      if (data.error) throw new Error(data.error);
      if (!data.id) throw new Error('No MO ID returned');

      // Don't confirm — just show success and stay
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (err: any) {
      console.error('Failed to save draft:', err);
      setSubmitError(err.message || 'Failed to save draft');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-emerald-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <BackHeader
        backLabel={bom.product_tmpl_id[1]}
        onBack={onBack}
        title="New manufacturing order"
      />

      <div className="pt-2">
        {/* Product (read-only) */}
        <div className="px-5 pb-3">
          <label className="text-[13px] text-gray-500 mb-1.5 block">
            Product
          </label>
          <div className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-900">
            {bom.product_tmpl_id[1]}
          </div>
        </div>

        {/* SQC Toggle */}
        <div className="mx-4 mb-3 flex items-center justify-between bg-gray-100 rounded-lg px-4 py-3">
          <div>
            <div className="text-[13px] text-gray-900 font-medium">
              Set qty by component
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Enter ingredient amount to calculate output
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSqcEnabled(!sqcEnabled);
              if (sqcEnabled) {
                setQty(String(baseQty));
                setDrivingComponentQty('');
              }
            }}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
              sqcEnabled ? 'bg-emerald-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                sqcEnabled ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Driving component selector + manual qty input (visible when SQC on) */}
        {sqcEnabled && (
          <div className="px-5 pb-3">
            <label className="text-[13px] text-gray-500 mb-1.5 block">
              Driving component
            </label>
            <select
              value={drivingComponentId || ''}
              onChange={(e) => {
                setDrivingComponentId(parseInt(e.target.value) || null);
                setDrivingComponentQty('');
              }}
              className="w-full px-3.5 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 mb-2"
            >
              <option value="">Select component...</option>
              {components.map((c) => (
                <option key={c.product_id} value={c.product_id}>
                  {c.product_name} ({c.uom})
                </option>
              ))}
            </select>

            {drivingComponentId && (
              <div>
                <label className="text-[13px] text-gray-500 mb-1.5 block">
                  How much {drivingComponent?.product_name || 'ingredient'} do you have?
                </label>
                <div className="flex items-center border border-emerald-200 rounded-lg bg-white overflow-hidden">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={drivingComponentQty}
                    onChange={(e) => setDrivingComponentQty(e.target.value)}
                    placeholder={`e.g. ${drivingComponent?.required_qty || 0}`}
                    className="flex-1 px-3.5 py-2.5 text-lg font-medium border-none bg-transparent focus:outline-none text-emerald-700 placeholder:text-gray-300"
                  />
                  <div className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">
                    {drivingComponent?.uom || 'kg'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quantity input */}
        <div className="px-5 pb-1">
          <label className="text-[13px] text-gray-500 mb-1.5 block">
            Quantity to produce{sqcEnabled ? ' (calculated)' : ''}
          </label>
        </div>
        <div className="mx-5 mb-1.5 flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden">
          <input
            type="number"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            readOnly={sqcEnabled}
            className={`flex-1 px-3.5 py-3 text-[22px] font-medium border-none bg-transparent focus:outline-none ${
              sqcEnabled ? 'text-emerald-600' : 'text-gray-900'
            }`}
          />
          <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">
            {uom}
          </div>
        </div>
        <div className="px-5 pb-2.5 text-xs text-gray-400">
          BOM base: {new Intl.NumberFormat('de-DE').format(baseQty)}{uom} \u00b7
          Ratio: {ratio.toFixed(2)}x
          {sqcEnabled && drivingComponent
            ? ` \u00b7 Based on ${drivingComponent.product_name}`
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
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 font-medium'
                    : 'bg-white text-gray-500 border-gray-200'
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
              Production Date
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900"
            />
          </div>
          <div className="flex-1">
            <label className="text-[13px] text-gray-500 mb-1.5 block">
              Responsible
            </label>
            <div className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900">
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
              className={`bg-white border rounded-lg px-3.5 py-2.5 flex justify-between items-center ${
                sqcEnabled && c.product_id === drivingComponentId
                  ? 'border-emerald-200'
                  : 'border-gray-200'
              }`}
            >
              <span className="text-[13px] text-gray-900">
                <StatusDot status={c.is_short ? 'out' : c.status} />
                {c.product_name}
                {sqcEnabled && c.product_id === drivingComponentId && (
                  <span className="text-[11px] text-emerald-600 ml-1">
                    (driving)
                  </span>
                )}
              </span>
              <div className="flex gap-4 items-baseline">
                <span
                  className={`text-[13px] font-medium ${
                    c.is_short ? 'text-red-600' : 'text-gray-900'
                  }`}
                >
                  {new Intl.NumberFormat('de-DE').format(c.scaled_qty)}{c.uom}
                </span>
                <span
                  className={`text-xs ${
                    c.is_short
                      ? 'text-red-500'
                      : sqcEnabled && c.product_id === drivingComponentId
                      ? 'text-emerald-600'
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
          <div className="mx-4 mt-1 mb-2 px-3.5 py-2.5 rounded-lg bg-amber-50 text-[13px] text-amber-700">
            {shortComponents.map((c) => c.product_name).join(', ')}:{' '}
            short for {new Intl.NumberFormat('de-DE').format(numQty)}{uom}.
            Max producible: {new Intl.NumberFormat('de-DE').format(maxProducible)}{uom}
          </div>
        )}
      </div>

      {/* Error message */}
      {submitError && (
        <div className="mx-4 mb-2 px-3.5 py-2.5 rounded-lg bg-red-50 text-[13px] text-red-700">
          {submitError}
        </div>
      )}

      {/* Draft saved banner */}
      {draftSaved && (
        <div className="mx-4 mb-2 px-3.5 py-2.5 rounded-lg bg-emerald-50 text-[13px] text-emerald-700">
          \u2705 Draft saved successfully
        </div>
      )}

      {/* Action bar */}
      <div className="px-4 pb-6 pt-3 bg-white border-t border-gray-200">
        <ActionButton
          onClick={handleConfirm}
          disabled={submitting || numQty <= 0}
        >
          {submitting
            ? 'Creating...'
            : `Confirm order (${new Intl.NumberFormat('de-DE').format(numQty)}${uom})`}
        </ActionButton>
        <div className="mt-2">
          <ActionButton
            variant="outline"
            onClick={handleSaveDraft}
            disabled={submitting || numQty <= 0}
          >
            Save as draft
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
