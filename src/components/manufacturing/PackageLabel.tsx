'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import LabelPreview from '@/components/manufacturing/LabelPreview';
import LabelSizeSelector from '@/components/manufacturing/LabelSizeSelector';
import { useZebraBluetooth } from '@/hooks/useZebraBluetooth';
import { useCompany } from '@/lib/company-context';

interface PackageLabelProps {
  moId: number;
  onBack: () => void;
  onDone: () => void;
}

interface ContainerRow {
  qty: string;
  expiryDate: string;
  type: string;
}

const CONTAINER_TYPES = ['Barrel', 'Bucket', 'Bin', 'Cambro', 'Bottle', 'Other'] as const;

type Step = 'split' | 'preview' | 'print';

/**
 * Calculate expiry date string (YYYY-MM-DD) from today + days.
 * Falls back to 14 days if shelfLifeDays is 0 or not provided.
 */
function calcExpiryDate(shelfLifeDays: number): string {
  const days = shelfLifeDays > 0 ? shelfLifeDays : 14;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function PackageLabel({ moId, onBack, onDone }: PackageLabelProps) {
  const { companyId } = useCompany();
  const [step, setStep] = useState<Step>('split');
  const [loading, setLoading] = useState(true);
  const [mo, setMo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitDone, setSplitDone] = useState(false);
  const [existingSplit, setExistingSplit] = useState<any>(null);
  const [existingContainers, setExistingContainers] = useState<any[]>([]);

  const [packSize, setPackSize] = useState('');
  const [packType, setPackType] = useState<typeof CONTAINER_TYPES[number]>('Barrel');

  const [selectedSize, setSelectedSize] = useState('55x75');
  const [customWidth, setCustomWidth] = useState('55');
  const [customHeight, setCustomHeight] = useState('75');
  const [printing, setPrinting] = useState(false);
  const [printedIds, setPrintedIds] = useState<Set<number>>(new Set());
  const [printingContainerId, setPrintingContainerId] = useState<number | null>(null);
  const [copiedZpl, setCopiedZpl] = useState<string | null>(null);

  const ble = useZebraBluetooth();

  // Shelf life from Odoo product settings (days)
  const shelfLifeDays = mo?.expiration_time_days || 0;
  const hasShelfLife = shelfLifeDays > 0;

  const labelDims = useMemo(() => {
    if (selectedSize === 'custom' || selectedSize?.startsWith('saved-')) {
      return { widthMm: parseFloat(customWidth) || 55, heightMm: parseFloat(customHeight) || 75 };
    }
    // For presets, customWidth/customHeight are synced by LabelSizeSelector
    return { widthMm: parseFloat(customWidth) || 55, heightMm: parseFloat(customHeight) || 75 };
  }, [selectedSize, customWidth, customHeight]);

  const handleSizeChange = useCallback((w: number, h: number, sizeId: string | null) => {
    setSelectedSize(sizeId ?? 'custom');
    setCustomWidth(String(w));
    setCustomHeight(String(h));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [moRes, splitRes] = await Promise.all([
          fetch(`/api/manufacturing-orders/${moId}`),
          fetch(`/api/manufacturing-orders/${moId}/package`),
        ]);
        const moData = await moRes.json();
        const splitData = await splitRes.json();
        const order = moData.order;
        setMo(order);

        // Initialize first container with auto-calculated expiry from product shelf life
        const defaultExpiry = calcExpiryDate(order?.expiration_time_days || 0);
        setContainers([{ qty: '', expiryDate: defaultExpiry, type: 'Barrel' }]);

        if (splitData.split && splitData.split.status !== 'draft') {
          setExistingSplit(splitData.split);
          setExistingContainers(splitData.containers || []);
          setSplitDone(true);
          setStep('preview');
          const alreadyPrinted = new Set<number>();
          for (const c of (splitData.containers || [])) {
            if (c.label_printed) alreadyPrinted.add(c.id);
          }
          setPrintedIds(alreadyPrinted);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [moId]);

  function addContainer() {
    const defaultExpiry = calcExpiryDate(shelfLifeDays);
    setContainers(prev => [...prev, { qty: '', expiryDate: defaultExpiry, type: 'Barrel' }]);
  }
  function removeContainer(idx: number) {
    if (containers.length <= 1) return;
    setContainers(prev => prev.filter((_, i) => i !== idx));
  }
  function updateContainer(idx: number, field: keyof ContainerRow, value: string) {
    setContainers(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  const totalQty = mo?.product_qty || 0;
  const uom = mo?.product_uom_id?.[1] || 'kg';
  const sumQty = containers.reduce((s, c) => s + (parseFloat(c.qty) || 0), 0);
  const remaining = totalQty - sumQty;
  const isBalanced = Math.abs(remaining) < totalQty * 0.001;
  const allFilled = containers.every(c => parseFloat(c.qty) > 0 && c.expiryDate);
  const canConfirm = isBalanced && allFilled && containers.length > 0;

  function autoFillLast() {
    if (containers.length < 2) return;
    const lastIdx = containers.length - 1;
    const otherSum = containers.slice(0, -1).reduce((s, c) => s + (parseFloat(c.qty) || 0), 0);
    const rem = totalQty - otherSum;
    if (rem > 0) updateContainer(lastIdx, 'qty', rem.toFixed(2));
  }

  const autoSplitPreview = useMemo(() => {
    const size = parseFloat(packSize);
    if (!(size > 0) || !(totalQty > 0)) return null;
    const fullPacks = Math.floor(totalQty / size);
    const remainder = +(totalQty - fullPacks * size).toFixed(3);
    const hasRemainder = remainder > 0.001;
    const totalContainers = fullPacks + (hasRemainder ? 1 : 0);
    if (totalContainers === 0) return null;
    return { fullPacks, size, remainder, hasRemainder, totalContainers };
  }, [packSize, totalQty]);

  function applyAutoSplit() {
    if (!autoSplitPreview) return;
    const { fullPacks, size, remainder, hasRemainder } = autoSplitPreview;
    const defaultExpiry = calcExpiryDate(shelfLifeDays);
    const rows: ContainerRow[] = [];
    for (let i = 0; i < fullPacks; i++) {
      rows.push({ qty: size.toFixed(2), expiryDate: defaultExpiry, type: packType });
    }
    if (hasRemainder) {
      rows.push({ qty: remainder.toFixed(2), expiryDate: defaultExpiry, type: packType });
    }
    setContainers(rows);
  }

  async function handleConfirmSplit() {
    if (!canConfirm || !mo) return;
    setSplitLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mo_id: moId, mo_name: mo.name,
          product_id: mo.product_id[0], product_name: mo.product_id[1],
          total_qty: totalQty, uom,
          containers: containers.map(c => ({ qty: parseFloat(c.qty), expiry_date: c.expiryDate })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || data.message || `Server error (${res.status})`);
        setSplitLoading(false);
        return;
      }
      if (data.errors && Array.isArray(data.errors)) {
        setError(data.errors.join('\n'));
      }
      if (data.split) {
        setExistingSplit(data.split);
        setExistingContainers(data.containers || []);
        setSplitDone(true);
        setStep('preview');
      } else if (!data.error && !data.errors) {
        setError('Unexpected response from server. Please try again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to package. Check your connection.');
    } finally {
      setSplitLoading(false);
    }
  }

  async function fetchZplAndPrint(containerIds?: number[]) {
    if (!ble.isConnected) { setError('Connect to a Zebra printer first'); return; }
    setPrinting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ label_size_id: selectedSize });
      if (selectedSize === 'custom' || selectedSize?.startsWith('saved-')) {
        params.set('custom_width_mm', customWidth);
        params.set('custom_height_mm', customHeight);
      }
      const targets = containerIds || existingContainers.map((c: any) => c.id);
      for (const cId of targets) {
        setPrintingContainerId(cId);
        params.set('container_id', String(cId));
        const res = await fetch(`/api/manufacturing-orders/${moId}/labels?${params}`);
        const data = await res.json();
        if (!res.ok || data.error) { setError(data.error || `Label generation failed (${res.status})`); break; }
        if (data.previews && data.previews.length > 0) {
          const success = await ble.print(data.previews[0].zpl);
          if (success) {
            setPrintedIds(prev => new Set([...Array.from(prev), cId]));
            setExistingContainers(prev => prev.map(c => c.id === cId ? { ...c, label_printed: 1 } : c));
          } else {
            setError(`Print failed for container ${existingContainers.find((c: any) => c.id === cId)?.sequence ?? '?'}`);
            break;
          }
          if (targets.length > 1) await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
      setPrintingContainerId(null);
    }
  }

  async function copyZplForContainer(containerId: number) {
    try {
      const params = new URLSearchParams({ label_size_id: selectedSize, container_id: String(containerId) });
      if (selectedSize === 'custom' || selectedSize?.startsWith('saved-')) {
        params.set('custom_width_mm', customWidth);
        params.set('custom_height_mm', customHeight);
      }
      const res = await fetch(`/api/manufacturing-orders/${moId}/labels?${params}`);
      const data = await res.json();
      if (data.previews?.[0]?.zpl) {
        await navigator.clipboard.writeText(data.previews[0].zpl);
        setCopiedZpl(String(containerId));
        setTimeout(() => setCopiedZpl(null), 2000);
      }
    } catch {
      setError('Failed to copy ZPL');
    }
  }

  async function copyAllZpl() {
    try {
      const params = new URLSearchParams({ label_size_id: selectedSize });
      if (selectedSize === 'custom' || selectedSize?.startsWith('saved-')) {
        params.set('custom_width_mm', customWidth);
        params.set('custom_height_mm', customHeight);
      }
      const allZpl: string[] = [];
      for (const c of existingContainers) {
        params.set('container_id', String(c.id));
        const res = await fetch(`/api/manufacturing-orders/${moId}/labels?${params}`);
        const data = await res.json();
        if (data.previews?.[0]?.zpl) allZpl.push(data.previews[0].zpl);
      }
      await navigator.clipboard.writeText(allZpl.join('\n'));
      setCopiedZpl('all');
      setTimeout(() => setCopiedZpl(null), 2000);
    } catch {
      setError('Failed to copy ZPL');
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);
  const fmtDate = (d: string | null) => {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('de-DE');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!mo) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Package & Label" showBack onBack={onBack} />
        <div className="p-4 text-center text-[var(--fs-sm)] text-gray-500">Manufacturing order not found</div>
      </div>
    );
  }

  const previewContainer = existingContainers[0];

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Package & Label"
        subtitle={`${mo.product_id[1]} \u2014 ${mo.name}`}
        showBack
        onBack={onBack}
      />

      {/* Step indicator */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex gap-1.5">
          {(['split', 'preview', 'print'] as Step[]).map((s, i) => {
            const labels = ['1. Split', '2. Preview', '3. Print'];
            const isDone = (s === 'split' && splitDone);
            const isCurrent = step === s;
            const isReachable = (s === 'split' && !splitDone) || (s !== 'split' && splitDone);
            return (
              <button key={s} onClick={() => isReachable && setStep(s)}
                className={`flex-1 py-2 rounded-lg text-[var(--fs-xs)] font-bold text-center transition-all ${
                  isCurrent ? 'bg-green-600 text-white' : isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                }`}>
                {isDone ? '\u2713 ' : ''}{labels[i]}
              </button>
            );
          })}
        </div>
      </div>

      {/* BLE status bar (Steps 2-3) */}
      {step !== 'split' && (
        <div className="px-4 pt-2">
          <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[var(--fs-xs)] font-semibold ${
            ble.isConnected ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'bg-gray-100 border border-gray-200 text-gray-500'
          }`}>
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              ble.isConnected ? 'bg-green-500' :
              ble.status === 'scanning' || ble.status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-gray-300'
            }`} />
            <span className="flex-1 truncate">
              {ble.isConnected ? ble.printerName :
               ble.status === 'scanning' ? 'Scanning\u2026' :
               ble.status === 'connecting' ? 'Connecting\u2026' : 'No printer connected'}
            </span>
            {ble.isConnected ? (
              <button onClick={ble.disconnect} className="text-blue-500 active:text-blue-700">Change</button>
            ) : (
              <button
                onClick={async () => { setError(null); const ok = await ble.connect(); if (!ok && ble.error) setError(ble.error); }}
                disabled={!ble.isSupported || ble.status === 'scanning' || ble.status === 'connecting'}
                className="text-blue-600 font-bold active:text-blue-800 disabled:opacity-50">
                Connect
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pt-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-[var(--fs-xs)] whitespace-pre-line">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 font-bold">{'\u2715'}</button>
          </div>
        </div>
      )}

      {/* ======== STEP 1: SPLIT ======== */}
      {step === 'split' && !splitDone && (
        <div className="px-4 pt-3 pb-24">
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">Total to package</div>
                <div className="text-[var(--fs-xxl)] font-extrabold text-gray-900 font-mono mt-0.5">{fmt(totalQty)} <span className="text-[var(--fs-sm)] font-semibold text-gray-400">{uom}</span></div>
              </div>
              <div className={`text-right ${isBalanced ? 'text-green-600' : remaining > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                <div className="text-[var(--fs-xs)] font-bold">REMAINING</div>
                <div className="text-[var(--fs-xl)] font-extrabold font-mono">{fmt(remaining)}</div>
              </div>
            </div>
            <div className="h-2 bg-gray-200 rounded-full mt-3 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${isBalanced ? 'bg-green-500' : sumQty > totalQty ? 'bg-red-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min((sumQty / totalQty) * 100, 100)}%` }} />
            </div>
          </div>

          {/* Shelf life info banner */}
          {hasShelfLife && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 flex-shrink-0">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              <span className="text-[var(--fs-xs)] text-blue-700 font-semibold">
                Shelf life: {shelfLifeDays} days &mdash; expiry auto-set to {fmtDate(calcExpiryDate(shelfLifeDays))}
              </span>
            </div>
          )}

          {/* Quick auto-split by pack size */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">Pack Size</div>
              <div className="text-[var(--fs-xs)] text-gray-400">Splits the total automatically</div>
            </div>
            <div className="flex gap-2 items-stretch">
              <div className="flex-1">
                <input type="number" inputMode="decimal" step="0.01" min="0"
                  value={packSize}
                  onChange={e => setPackSize(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && autoSplitPreview) { e.preventDefault(); applyAutoSplit(); } }}
                  placeholder={`e.g. 2 ${uom}`}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-green-600 focus:ring-2 focus:ring-green-100 outline-none" />
              </div>
              <select value={packType} onChange={e => setPackType(e.target.value as typeof CONTAINER_TYPES[number])}
                className="px-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-sm)] font-bold text-gray-700 outline-none focus:border-green-600">
                {CONTAINER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={applyAutoSplit} disabled={!autoSplitPreview}
                className="px-5 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] active:scale-[0.975] disabled:opacity-40 disabled:bg-gray-200 disabled:text-gray-400">
                Apply
              </button>
            </div>
            {autoSplitPreview && (
              <div className="mt-2.5 text-[var(--fs-xs)] font-semibold text-gray-600">
                {'→ '}
                {autoSplitPreview.fullPacks > 0 && `${autoSplitPreview.fullPacks} × ${fmt(autoSplitPreview.size)} ${uom}`}
                {autoSplitPreview.fullPacks > 0 && autoSplitPreview.hasRemainder && ' + '}
                {autoSplitPreview.hasRemainder && `1 × ${fmt(autoSplitPreview.remainder)} ${uom}`}
                {' '}({autoSplitPreview.totalContainers} {autoSplitPreview.totalContainers === 1 ? 'container' : 'containers'})
              </div>
            )}
          </div>

          {containers.map((c, idx) => (
            <div key={idx} className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center font-extrabold text-[var(--fs-sm)]">{idx + 1}</div>
                  <select value={c.type} onChange={e => updateContainer(idx, 'type', e.target.value)}
                    className="text-[var(--fs-sm)] font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-green-500">
                    {CONTAINER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {containers.length > 1 && (
                  <button onClick={() => removeContainer(idx)}
                    className="w-8 h-8 rounded-lg bg-red-50 text-red-400 flex items-center justify-center active:bg-red-100">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-1.5 block">Qty ({uom})</label>
                  <input type="number" inputMode="decimal" step="0.01" min="0"
                    value={c.qty} onChange={e => updateContainer(idx, 'qty', e.target.value)} placeholder="0.00"
                    className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-green-600 focus:ring-2 focus:ring-green-100 outline-none" />
                </div>
                <div className="flex-1">
                  <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-1.5 block">Expiry</label>
                  <input type="date" value={c.expiryDate} onChange={e => updateContainer(idx, 'expiryDate', e.target.value)}
                    className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] text-gray-900 focus:border-green-600 focus:ring-2 focus:ring-green-100 outline-none" />
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-2 mb-6">
            <button onClick={addContainer}
              className="flex-1 py-3.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold text-[var(--fs-sm)] active:bg-gray-50 flex items-center justify-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Add Container
            </button>
            {containers.length >= 2 && remaining > 0 && (
              <button onClick={autoFillLast}
                className="py-3.5 px-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-[var(--fs-sm)] active:bg-amber-100">
                Auto-fill last ({fmt(remaining)})
              </button>
            )}
          </div>

          <button onClick={handleConfirmSplit} disabled={!canConfirm || splitLoading}
            className={`w-full py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg transition-all active:scale-[0.975] disabled:opacity-50 ${
              canConfirm ? 'bg-green-600 text-white shadow-green-600/30' : 'bg-gray-200 text-gray-400 shadow-none'
            }`}>
            {splitLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Producing {containers.length} containers...
              </span>
            ) : (
              `Confirm & Produce (${containers.length} containers)`
            )}
          </button>
        </div>
      )}

      {/* ======== STEP 2: PREVIEW ======== */}
      {step === 'preview' && splitDone && (
        <div className="px-4 pt-3 pb-24">
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-4">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-3">Label Preview</div>
            <div className="flex justify-center py-2 bg-gray-50 rounded-lg">
              <LabelPreview
                productName={existingSplit?.product_name || mo.product_id[1]}
                productionDate={fmtDate(existingSplit?.confirmed_at || existingSplit?.created_at)}
                qty={previewContainer?.qty || totalQty}
                uom={existingSplit?.uom || uom}
                expiryDate={fmtDate(previewContainer?.expiry_date)}
                lotName={previewContainer?.lot_name}
                moName={existingSplit?.mo_name || mo.name}
                containerNumber={1}
                totalContainers={existingContainers.length}
                widthMm={labelDims.widthMm}
                heightMm={labelDims.heightMm}
              />
            </div>
          </div>

          {/* Label Size Selector (dropdown with save + default) */}
          <LabelSizeSelector companyId={companyId} onSizeChange={handleSizeChange} />

          <div className="mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 px-1">
              {existingContainers.length} Container{existingContainers.length !== 1 ? 's' : ''} to label
            </div>
            {existingContainers.map((c: any) => (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-3 mb-1.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center font-extrabold text-[var(--fs-xs)]">{c.sequence}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-[var(--fs-sm)] font-bold text-gray-900">{fmt(c.qty)} {existingSplit?.uom || uom}</span>
                  <span className="text-[var(--fs-xs)] text-gray-400 ml-2">{c.lot_name || ''}</span>
                </div>
                <span className="text-[var(--fs-xs)] text-gray-400">Exp {fmtDate(c.expiry_date)}</span>
              </div>
            ))}
          </div>

          <button onClick={() => setStep('print')}
            className="w-full py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg transition-all active:scale-[0.975] bg-green-600 text-white shadow-green-600/30">
            Continue to Print
          </button>
        </div>
      )}

      {/* ======== STEP 3: PRINT ======== */}
      {step === 'print' && splitDone && (
        <div className="px-4 pt-3 pb-24">
          <div className="mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 px-1">Print Status</div>
            {existingContainers.map((c: any) => {
              const isPrinted = printedIds.has(c.id) || c.label_printed;
              const isPrintingThis = printingContainerId === c.id;
              const isCopied = copiedZpl === String(c.id);
              return (
                <div key={c.id} className={`bg-white border rounded-xl p-4 mb-2 flex items-center gap-3 ${
                  isPrinted ? 'border-green-200 bg-green-50/30' : isPrintingThis ? 'border-blue-200 bg-blue-50/20' : 'border-gray-200'
                }`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-[var(--fs-sm)] ${
                    isPrinted ? 'bg-green-500 text-white' : isPrintingThis ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isPrintingThis ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : isPrinted ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                    ) : c.sequence}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900">{fmt(c.qty)} {existingSplit?.uom || uom}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                      {c.lot_name || 'No lot'} {'\u2022'} Exp {fmtDate(c.expiry_date)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {ble.isConnected ? (
                      <button onClick={() => fetchZplAndPrint([c.id])} disabled={printing}
                        className={`text-[var(--fs-xs)] px-3 py-2 rounded-xl font-bold text-center disabled:opacity-40 ${
                          isPrinted ? 'bg-gray-100 text-gray-600 active:bg-gray-200' : 'bg-green-600 text-white active:bg-green-700 shadow-sm'
                        }`}>
                        {isPrintingThis ? '\u2026' : isPrinted ? 'Reprint' : 'Print'}
                      </button>
                    ) : (
                      <button onClick={() => copyZplForContainer(c.id)}
                        className={`text-[var(--fs-xs)] px-3 py-2 rounded-xl font-bold text-center ${
                          isCopied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                        }`}>
                        {isCopied ? '\u2713 Copied' : 'Copy ZPL'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button onClick={onDone}
              className="py-4 px-5 rounded-xl bg-white border border-gray-200 text-gray-600 font-bold text-[var(--fs-sm)] active:bg-gray-50">
              Done
            </button>
            {ble.isConnected ? (
              <button onClick={() => fetchZplAndPrint()} disabled={printing}
                className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
                {printing ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Printing...
                  </span>
                ) : (
                  `Print All (${existingContainers.length} labels)`
                )}
              </button>
            ) : (
              <button onClick={copyAllZpl}
                className={`flex-1 py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg active:scale-[0.975] transition-transform ${
                  copiedZpl === 'all' ? 'bg-green-100 text-green-700 shadow-none' : 'bg-gray-700 text-white shadow-gray-700/30'
                }`}>
                {copiedZpl === 'all' ? '\u2713 ZPL Copied to Clipboard' : `Copy All ZPL (${existingContainers.length} labels)`}
              </button>
            )}
          </div>

          {!ble.isConnected && (
            <p className="text-[var(--fs-xs)] text-gray-400 text-center mt-3 px-4">
              No BLE printer connected. Copy ZPL and send to printer via terminal:
              <code className="block mt-1 bg-gray-100 rounded-lg px-3 py-2 text-left text-gray-600 font-mono">
                echo &apos;PASTE_ZPL&apos; &gt; /dev/tty.ZD420*
              </code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
