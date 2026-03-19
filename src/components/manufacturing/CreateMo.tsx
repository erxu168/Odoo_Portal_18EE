'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { StatusDot, ActionButton } from './ui';
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

  const [qty, setQty] = useState('');
  const [sqcEnabled, setSqcEnabled] = useState(false);
  const [drivingComponentId, setDrivingComponentId] = useState<number | null>(null);
  const [drivingComponentQty, setDrivingComponentQty] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } finally { setLoading(false); }
  }

  const numQty = parseFloat(qty) || 0;
  const baseQty = bom?.product_qty || 1;
  const ratio = baseQty > 0 ? numQty / baseQty : 0;

  const scaledComponents = useMemo(() => {
    return components.map((c) => {
      const scaled = Math.round(c.required_qty * ratio * 1000) / 1000;
      const short = scaled - c.on_hand_qty;
      return { ...c, scaled_qty: scaled, is_short: short > 0, short_amount: Math.max(0, Math.round(short * 1000) / 1000) };
    });
  }, [components, ratio]);

  const maxProducible = useMemo(() => {
    if (!components.length || baseQty <= 0) return 0;
    let minQty = Infinity;
    for (const c of components) {
      if (c.required_qty > 0) { minQty = Math.min(minQty, (c.on_hand_qty / c.required_qty) * baseQty); }
    }
    return minQty === Infinity ? 0 : Math.floor(minQty);
  }, [components, baseQty]);

  const shortcuts = useMemo(() => {
    if (!baseQty) return [];
    return [0.5, 1, 1.5, 2, 3].map((m) => ({ label: `${new Intl.NumberFormat('de-DE').format(Math.round(baseQty * m))}`, value: Math.round(baseQty * m) }));
  }, [baseQty]);

  const drivingComponent = useMemo(() => {
    if (!sqcEnabled || !drivingComponentId) return null;
    return components.find((c) => c.product_id === drivingComponentId) || null;
  }, [sqcEnabled, drivingComponentId, components]);

  useEffect(() => {
    if (sqcEnabled && drivingComponent) {
      const manualQty = parseFloat(drivingComponentQty);
      if (!isNaN(manualQty) && manualQty > 0 && drivingComponent.required_qty > 0) {
        setQty(String(Math.round((manualQty / drivingComponent.required_qty) * baseQty * 100) / 100));
      } else if (!drivingComponentQty) {
        const r = drivingComponent.required_qty > 0 ? drivingComponent.on_hand_qty / drivingComponent.required_qty : 0;
        setQty(String(Math.floor(r * baseQty)));
      }
    }
  }, [sqcEnabled, drivingComponent, drivingComponentQty, baseQty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sqcEnabled && !drivingComponentId && components.length) setDrivingComponentId(components[0].product_id);
  }, [sqcEnabled, components, drivingComponentId]);

  const shortComponents = scaledComponents.filter((c) => c.is_short);
  const uom = bom?.product_uom_id?.[1] || 'kg';

  async function handleConfirm() {
    if (!bom || numQty <= 0) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const res = await fetch('/api/manufacturing-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: bom.product_id?.[0] || bom.product_tmpl_id[0], bom_id: bom.id, product_qty: numQty, product_uom_id: bom.product_uom_id[0], date_deadline: scheduledDate }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.id) throw new Error('No MO ID returned');
      const cr = await fetch(`/api/manufacturing-orders/${data.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) });
      const cd = await cr.json(); if (cd.error) throw new Error(cd.error);
      onCreated(data.id);
    } catch (err: any) { setSubmitError(err.message || 'Failed to create order'); }
    finally { setSubmitting(false); }
  }

  async function handleSaveDraft() {
    if (!bom || numQty <= 0) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const res = await fetch('/api/manufacturing-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: bom.product_id?.[0] || bom.product_tmpl_id[0], bom_id: bom.id, product_qty: numQty, product_uom_id: bom.product_uom_id[0], date_deadline: scheduledDate }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDraftSaved(true); setTimeout(() => setDraftSaved(false), 3000);
    } catch (err: any) { setSubmitError(err.message || 'Failed to save draft'); }
    finally { setSubmitting(false); }
  }

  if (loading || !bom) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
        <button onClick={onBack} className="flex items-center gap-1 mb-2 text-orange-600 text-[13px] font-semibold active:opacity-70">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          {bom.product_tmpl_id[1]}
        </button>
        <h1 className="text-[18px] font-bold text-gray-900">New manufacturing order</h1>
      </div>

      <div className="pt-2">
        <div className="px-5 pb-3">
          <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Product</label>
          <div className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[14px] font-semibold text-gray-900">{bom.product_tmpl_id[1]}</div>
        </div>

        <div className="mx-4 mb-3 flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-[13px] text-gray-900 font-semibold">Set qty by ingredient</div>
            <div className="text-[11px] text-gray-400 mt-0.5">Enter ingredient amount to calculate output</div>
          </div>
          <button type="button" onClick={() => { setSqcEnabled(!sqcEnabled); if (sqcEnabled) { setQty(String(baseQty)); setDrivingComponentQty(''); } }}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${sqcEnabled ? 'bg-orange-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sqcEnabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        {sqcEnabled && (
          <div className="px-5 pb-3">
            <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Driving ingredient</label>
            <select value={drivingComponentId || ''} onChange={(e) => { setDrivingComponentId(parseInt(e.target.value) || null); setDrivingComponentQty(''); }}
              className="w-full px-4 py-3 rounded-xl border border-orange-200 bg-orange-50 text-[14px] font-semibold text-orange-700 mb-2">
              <option value="">Select ingredient...</option>
              {components.map((c) => <option key={c.product_id} value={c.product_id}>{c.product_name} ({c.uom})</option>)}
            </select>
            {drivingComponentId && (
              <div>
                <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">How much {drivingComponent?.product_name || 'ingredient'} do you have?</label>
                <div className="flex items-center border border-orange-200 rounded-xl bg-white overflow-hidden">
                  <input type="number" inputMode="decimal" value={drivingComponentQty} onChange={(e) => setDrivingComponentQty(e.target.value)}
                    placeholder={`e.g. ${drivingComponent?.required_qty || 0}`}
                    className="flex-1 px-4 py-3 text-lg font-bold border-none bg-transparent focus:outline-none text-orange-600 placeholder:text-gray-300" />
                  <div className="px-3 py-3 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">{drivingComponent?.uom || 'kg'}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-5 pb-1">
          <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Quantity to produce{sqcEnabled ? ' (calculated)' : ''}</label>
        </div>
        <div className="mx-5 mb-1.5 flex items-center border border-gray-200 rounded-xl bg-white overflow-hidden">
          <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} readOnly={sqcEnabled}
            className={`flex-1 px-4 py-3 text-[22px] font-bold border-none bg-transparent focus:outline-none ${sqcEnabled ? 'text-orange-500' : 'text-gray-900'}`} />
          <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">{uom}</div>
        </div>
        <div className="px-5 pb-2.5 text-[11px] text-gray-400">
          BOM base: {new Intl.NumberFormat('de-DE').format(baseQty)}{uom} &middot; Ratio: {ratio.toFixed(2)}x
          {sqcEnabled && drivingComponent ? ` &middot; Based on ${drivingComponent.product_name}` : ''}
        </div>

        {!sqcEnabled && (
          <div className="flex gap-2 px-5 pb-3.5 flex-wrap">
            {shortcuts.map((s) => (
              <button key={s.value} onClick={() => setQty(String(s.value))}
                className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-all ${
                  numQty === s.value ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-gray-500 border-gray-200'
                }`}>{s.label}{uom}</button>
            ))}
          </div>
        )}

        <div className="px-5 pb-3 flex gap-3">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Production date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[14px] text-gray-900" />
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Responsible</label>
            <div className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[14px] text-gray-900">Ethan</div>
          </div>
        </div>

        <div className="px-5 pt-1 pb-2">
          <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">Scaled ingredients ({new Intl.NumberFormat('de-DE').format(numQty)}{uom})</p>
        </div>
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {scaledComponents.map((c) => (
            <div key={c.product_id} className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center ${sqcEnabled && c.product_id === drivingComponentId ? 'border-orange-200' : 'border-gray-200'}`}>
              <span className="text-[13px] text-gray-900 flex items-center gap-1.5">
                <StatusDot status={c.is_short ? 'out' : c.status} />
                {c.product_name}
                {sqcEnabled && c.product_id === drivingComponentId && <span className="text-[11px] text-orange-600 font-semibold">(driving)</span>}
              </span>
              <div className="flex gap-4 items-baseline">
                <span className={`text-[13px] font-bold font-mono ${c.is_short ? 'text-red-600' : 'text-gray-900'}`}>{new Intl.NumberFormat('de-DE').format(c.scaled_qty)}{c.uom}</span>
                <span className={`text-[11px] ${c.is_short ? 'text-red-500' : 'text-emerald-600'}`}>{new Intl.NumberFormat('de-DE').format(c.on_hand_qty)} {c.uom} avail</span>
              </div>
            </div>
          ))}
        </div>

        {shortComponents.length > 0 && (
          <div className="mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-700">
            {shortComponents.map((c) => c.product_name).join(', ')}: short for {new Intl.NumberFormat('de-DE').format(numQty)}{uom}.
            Max: {new Intl.NumberFormat('de-DE').format(maxProducible)}{uom}
          </div>
        )}
      </div>

      {submitError && <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">{submitError}</div>}
      {draftSaved && <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">&#x2705; Draft saved</div>}

      <div className="px-4 pb-6 pt-3">
        <ActionButton onClick={handleConfirm} disabled={submitting || numQty <= 0}>
          {submitting ? 'Creating...' : `Confirm order (${new Intl.NumberFormat('de-DE').format(numQty)}${uom})`}
        </ActionButton>
        <div className="mt-2">
          <ActionButton variant="outline" onClick={handleSaveDraft} disabled={submitting || numQty <= 0}>Save as draft</ActionButton>
        </div>
      </div>
    </div>
  );
}
