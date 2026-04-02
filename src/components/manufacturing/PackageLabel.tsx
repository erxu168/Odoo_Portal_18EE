'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface PackageLabelProps {
  moId: number;
  onBack: () => void;
  onDone: () => void;
}

interface ContainerRow {
  id?: number;
  qty: string;
  expiryDate: string;
  lotName?: string;
  lotId?: number;
  labelPrinted?: boolean;
}

interface PrinterOption {
  id: number;
  name: string;
  ip_address: string;
  location_name: string;
  default_label_size_id: string;
}

interface LabelPreset {
  id: string;
  name: string;
  category: string;
  widthMm: number;
  heightMm: number;
  description: string;
}

type Step = 'split' | 'print';

export default function PackageLabel({ moId, onBack, onDone }: PackageLabelProps) {
  const [step, setStep] = useState<Step>('split');
  const [loading, setLoading] = useState(true);
  const [mo, setMo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Split state
  const [containers, setContainers] = useState<ContainerRow[]>([
    { qty: '', expiryDate: getDefaultExpiry() },
  ]);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitDone, setSplitDone] = useState(false);
  const [existingSplit, setExistingSplit] = useState<any>(null);
  const [existingContainers, setExistingContainers] = useState<any[]>([]);

  // Print state
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [labelPresets, setLabelPresets] = useState<LabelPreset[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<number | null>(null);
  const [selectedSize, setSelectedSize] = useState('4x4');
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [printing, setPrinting] = useState(false);
  const [printResults, setPrintResults] = useState<any[] | null>(null);
  const [zplPreviews, setZplPreviews] = useState<any[]>([]);

  function getDefaultExpiry(): string {
    const d = new Date();
    d.setDate(d.getDate() + 14); // 14 day default shelf life
    return d.toISOString().slice(0, 10);
  }

  // Fetch MO detail + existing split
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [moRes, splitRes, printerRes] = await Promise.all([
          fetch(`/api/manufacturing-orders/${moId}`),
          fetch(`/api/manufacturing-orders/${moId}/package`),
          fetch('/api/printers'),
        ]);
        const moData = await moRes.json();
        const splitData = await splitRes.json();
        const printerData = await printerRes.json();

        setMo(moData.order);

        if (splitData.split && splitData.split.status !== 'draft') {
          setExistingSplit(splitData.split);
          setExistingContainers(splitData.containers || []);
          setSplitDone(true);
          setStep('print');
        }

        setPrinters(printerData.printers || []);
        setLabelPresets(printerData.label_presets || []);
        if (printerData.printers?.length > 0) {
          setSelectedPrinter(printerData.printers[0].id);
          setSelectedSize(printerData.printers[0].default_label_size_id || '4x4');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [moId]);

  // Container CRUD
  function addContainer() {
    setContainers(prev => [...prev, { qty: '', expiryDate: getDefaultExpiry() }]);
  }

  function removeContainer(idx: number) {
    if (containers.length <= 1) return;
    setContainers(prev => prev.filter((_, i) => i !== idx));
  }

  function updateContainer(idx: number, field: 'qty' | 'expiryDate', value: string) {
    setContainers(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  // Validation
  const totalQty = mo?.product_qty || 0;
  const uom = mo?.product_uom_id?.[1] || 'kg';
  const sumQty = containers.reduce((s, c) => s + (parseFloat(c.qty) || 0), 0);
  const remaining = totalQty - sumQty;
  const isBalanced = Math.abs(remaining) < totalQty * 0.001;
  const allFilled = containers.every(c => parseFloat(c.qty) > 0 && c.expiryDate);
  const canConfirm = isBalanced && allFilled && containers.length > 0;

  // Auto-fill last container
  function autoFillLast() {
    if (containers.length < 2) return;
    const lastIdx = containers.length - 1;
    const otherSum = containers.slice(0, -1).reduce((s, c) => s + (parseFloat(c.qty) || 0), 0);
    const rem = totalQty - otherSum;
    if (rem > 0) {
      updateContainer(lastIdx, 'qty', rem.toFixed(2));
    }
  }

  // Submit split
  async function handleConfirmSplit() {
    if (!canConfirm || !mo) return;
    setSplitLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mo_id: moId,
          mo_name: mo.name,
          product_id: mo.product_id[0],
          product_name: mo.product_id[1],
          total_qty: totalQty,
          uom,
          containers: containers.map(c => ({
            qty: parseFloat(c.qty),
            expiry_date: c.expiryDate,
          })),
        }),
      });
      const data = await res.json();
      if (data.errors) {
        setError(data.errors.join('\n'));
      }
      if (data.split) {
        setExistingSplit(data.split);
        setExistingContainers(data.containers || []);
        setSplitDone(true);
        setStep('print');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to package');
    } finally {
      setSplitLoading(false);
    }
  }

  // Print labels
  async function handlePrint(containerIds?: number[]) {
    if (!selectedPrinter) { setError('Select a printer'); return; }
    setPrinting(true);
    setError(null);
    setPrintResults(null);
    try {
      const body: any = {
        printer_id: selectedPrinter,
        label_size_id: selectedSize,
      };
      if (containerIds) body.container_ids = containerIds;
      if (selectedSize === 'custom') {
        body.custom_width_mm = parseFloat(customWidth);
        body.custom_height_mm = parseFloat(customHeight);
      }
      const res = await fetch(`/api/manufacturing-orders/${moId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setPrintResults(data.results || []);
      if (data.allPrinted) {
        // Refresh containers to show printed status
        const splitRes = await fetch(`/api/manufacturing-orders/${moId}/package`);
        const splitData = await splitRes.json();
        setExistingContainers(splitData.containers || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
    }
  }

  // Format number
  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!mo) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Package & Label" showBack onBack={onBack} />
        <div className="p-4 text-center text-gray-500">MO not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title="Package & Label"
        subtitle={`${mo.product_id[1]} \u2014 ${mo.name}`}
        showBack
        onBack={onBack}
      />

      {/* Step indicator */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => !splitDone && setStep('split')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold text-center transition-all ${
              step === 'split' ? 'bg-green-600 text-white' : splitDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {splitDone ? '\u2713 ' : '1. '}Split
          </button>
          <button
            onClick={() => splitDone && setStep('print')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold text-center transition-all ${
              step === 'print' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'
            }`}
          >
            2. Print Labels
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 pt-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm whitespace-pre-line">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 font-bold">\u2715</button>
          </div>
        </div>
      )}

      {/* ============ STEP 1: SPLIT ============ */}
      {step === 'split' && !splitDone && (
        <div className="px-4 pt-3 pb-32">
          {/* Summary card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-xs text-gray-400 font-semibold">TOTAL TO PACKAGE</div>
                <div className="text-2xl font-extrabold text-gray-900 font-mono">{fmt(totalQty)} <span className="text-base font-semibold text-gray-400">{uom}</span></div>
              </div>
              <div className={`text-right ${isBalanced ? 'text-green-600' : remaining > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                <div className="text-xs font-semibold">REMAINING</div>
                <div className="text-xl font-extrabold font-mono">{fmt(remaining)} {uom}</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 bg-gray-200 rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isBalanced ? 'bg-green-500' : sumQty > totalQty ? 'bg-red-500' : 'bg-amber-500'}`}
                style={{ width: `${Math.min((sumQty / totalQty) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Container rows */}
          {containers.map((c, idx) => (
            <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-100 text-green-700 flex items-center justify-center font-extrabold text-sm">
                    {idx + 1}
                  </div>
                  <span className="text-sm font-bold text-gray-700">Container {idx + 1}</span>
                </div>
                {containers.length > 1 && (
                  <button
                    onClick={() => removeContainer(idx)}
                    className="w-8 h-8 rounded-lg bg-red-50 text-red-400 flex items-center justify-center active:bg-red-100"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 font-semibold mb-1 block">QUANTITY ({uom})</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={c.qty}
                    onChange={e => updateContainer(idx, 'qty', e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-3 border border-gray-200 rounded-xl text-lg font-mono font-bold text-gray-900 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 font-semibold mb-1 block">EXPIRY DATE</label>
                  <input
                    type="date"
                    value={c.expiryDate}
                    onChange={e => updateContainer(idx, 'expiryDate', e.target.value)}
                    className="w-full px-3 py-3 border border-gray-200 rounded-xl text-base text-gray-900 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Add + Auto-fill */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={addContainer}
              className="flex-1 py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold text-sm active:bg-gray-50 flex items-center justify-center gap-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Add Container
            </button>
            {containers.length >= 2 && remaining > 0 && (
              <button
                onClick={autoFillLast}
                className="py-3 px-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-sm active:bg-amber-100"
              >
                Auto-fill last ({fmt(remaining)})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ============ STEP 2: PRINT ============ */}
      {step === 'print' && splitDone && (
        <div className="px-4 pt-3 pb-32">
          {/* Container summary */}
          <div className="mb-4">
            <div className="text-xs font-bold text-gray-400 tracking-wider mb-2">CONTAINERS</div>
            {existingContainers.map((c: any) => (
              <div key={c.id} className={`bg-white border rounded-xl p-4 mb-2 flex items-center gap-3 ${
                c.label_printed ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
              }`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm ${
                  c.label_printed ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {c.label_printed ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  ) : c.sequence}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-900">{fmt(c.qty)} {existingSplit?.uom || uom}</div>
                  <div className="text-xs text-gray-400">
                    {c.lot_name || 'No lot'}
                    {c.expiry_date && ` \u2022 Exp: ${new Date(c.expiry_date).toLocaleDateString('de-DE')}`}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {c.label_printed ? (
                    <button
                      onClick={() => handlePrint([c.id])}
                      disabled={printing || !selectedPrinter}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 font-semibold active:bg-gray-200 disabled:opacity-50"
                    >
                      Reprint
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePrint([c.id])}
                      disabled={printing || !selectedPrinter}
                      className="text-xs px-3 py-1.5 rounded-lg bg-green-100 text-green-700 font-semibold active:bg-green-200 disabled:opacity-50"
                    >
                      Print
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Printer selection */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="text-xs font-bold text-gray-400 tracking-wider mb-2">PRINTER</div>
            {printers.length === 0 ? (
              <div className="text-sm text-gray-400 py-2">No printers configured. Ask an admin to add one in Settings.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {printers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPrinter(p.id);
                      setSelectedSize(p.default_label_size_id || '4x4');
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      selectedPrinter === p.id ? 'border-green-500 bg-green-50' : 'border-gray-100 active:bg-gray-50'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      selectedPrinter === p.id ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'
                    }`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    </div>
                    <div>
                      <div className="font-bold text-sm text-gray-900">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.location_name} \u2022 {p.ip_address}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Label size selection */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="text-xs font-bold text-gray-400 tracking-wider mb-2">LABEL SIZE</div>
            <div className="grid grid-cols-2 gap-1.5">
              {labelPresets.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedSize(p.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    selectedSize === p.id ? 'border-green-500 bg-green-50' : 'border-gray-100 active:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-bold text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.widthMm}\u00d7{p.heightMm}mm \u2022 {p.description}</div>
                </button>
              ))}
              {/* Custom option */}
              <button
                onClick={() => setSelectedSize('custom')}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  selectedSize === 'custom' ? 'border-green-500 bg-green-50' : 'border-gray-100 active:bg-gray-50'
                }`}
              >
                <div className="text-sm font-bold text-gray-900">Custom</div>
                <div className="text-xs text-gray-400">Enter dimensions</div>
              </button>
            </div>
            {selectedSize === 'custom' && (
              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 font-semibold mb-1 block">WIDTH (mm)</label>
                  <input
                    type="number" inputMode="decimal" min="20" max="108"
                    value={customWidth} onChange={e => setCustomWidth(e.target.value)}
                    placeholder="102" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:border-green-500 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 font-semibold mb-1 block">HEIGHT (mm)</label>
                  <input
                    type="number" inputMode="decimal" min="25" max="300"
                    value={customHeight} onChange={e => setCustomHeight(e.target.value)}
                    placeholder="102" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:border-green-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Print results */}
          {printResults && (
            <div className="mb-4">
              {printResults.map((r: any) => (
                <div key={r.container_id} className={`px-4 py-2 rounded-xl mb-1 text-sm font-semibold ${
                  r.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  Container {existingContainers.find((c: any) => c.id === r.container_id)?.sequence ?? '?'}:
                  {r.success ? ' \u2713 Printed' : ` \u2717 ${r.error}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ BOTTOM BAR ============ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 pb-8 z-30">
        {step === 'split' && !splitDone && (
          <button
            onClick={handleConfirmSplit}
            disabled={!canConfirm || splitLoading}
            className={`w-full py-4 rounded-xl font-bold text-base shadow-lg transition-all active:scale-[0.975] disabled:opacity-50 ${
              canConfirm ? 'bg-green-600 text-white shadow-green-600/30' : 'bg-gray-200 text-gray-400 shadow-none'
            }`}
          >
            {splitLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Producing {containers.length} containers...
              </span>
            ) : (
              `Confirm & Produce (${containers.length} containers)`
            )}
          </button>
        )}

        {step === 'print' && splitDone && (
          <div className="flex gap-2">
            <button
              onClick={onDone}
              className="py-4 px-6 rounded-xl bg-white border border-gray-200 text-gray-600 font-bold text-sm active:bg-gray-50"
            >
              Done
            </button>
            <button
              onClick={() => handlePrint()}
              disabled={printing || !selectedPrinter || printers.length === 0}
              className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-base shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50"
            >
              {printing ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Printing...
                </span>
              ) : (
                `Print All Labels (${existingContainers.length})`
              )}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
