'use client';

import React, { useState, useMemo, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import LabelPreview from '@/components/manufacturing/LabelPreview';
import LabelSizeSelector from '@/components/manufacturing/LabelSizeSelector';
import { useZebraBluetooth } from '@/hooks/useZebraBluetooth';
import { useCompany } from '@/lib/company-context';

interface CustomLabelPrintProps {
  onBack: () => void;
  onDone: () => void;
}

interface LabelRow {
  lotName: string;
}

type Step = 'config' | 'print';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function generateLotName(seq: number): string {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `LBL-${date}-${time}-${pad(seq)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CustomLabelPrint({ onBack, onDone }: CustomLabelPrintProps) {
  const { companyId } = useCompany();
  const [step, setStep] = useState<Step>('config');
  const [error, setError] = useState<string | null>(null);

  const [productName, setProductName] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('');
  const [productionDate, setProductionDate] = useState(todayIso());
  const [expiryDate, setExpiryDate] = useState('');
  const [labelCount, setLabelCount] = useState('1');
  const [labels, setLabels] = useState<LabelRow[]>([]);

  const [selectedSize, setSelectedSize] = useState('55x75');
  const [customWidth, setCustomWidth] = useState('55');
  const [customHeight, setCustomHeight] = useState('75');
  const [printing, setPrinting] = useState(false);
  const [printedSeqs, setPrintedSeqs] = useState<Set<number>>(new Set());
  const [printingSeq, setPrintingSeq] = useState<number | null>(null);
  const [copiedSeq, setCopiedSeq] = useState<string | null>(null);

  const ble = useZebraBluetooth();

  const labelDims = useMemo(() => ({
    widthMm: parseFloat(customWidth) || 55,
    heightMm: parseFloat(customHeight) || 75,
  }), [customWidth, customHeight]);

  const handleSizeChange = useCallback((w: number, h: number, sizeId: string | null) => {
    setSelectedSize(sizeId ?? 'custom');
    setCustomWidth(String(w));
    setCustomHeight(String(h));
  }, []);

  const qtyNum = parseFloat(qty) || 0;
  const countNum = Math.max(1, parseInt(labelCount, 10) || 1);
  const canGenerate = productName.trim().length > 0;

  const fmtDate = (d: string) => {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('de-DE');
  };

  function handleGenerate() {
    if (!canGenerate) return;
    setError(null);
    const rows: LabelRow[] = [];
    for (let i = 0; i < countNum; i++) {
      rows.push({ lotName: generateLotName(i + 1) });
    }
    setLabels(rows);
    setPrintedSeqs(new Set());
    setStep('print');
  }

  async function fetchZpl(idx: number): Promise<string | null> {
    const row = labels[idx];
    const body = {
      productName: productName.trim(),
      qty: qtyNum,
      uom,
      productionDate: fmtDate(productionDate),
      expiryDate: fmtDate(expiryDate),
      lotName: row.lotName,
      containerNumber: idx + 1,
      totalContainers: labels.length,
      labelSizeId: selectedSize,
      widthMm: parseFloat(customWidth) || 55,
      heightMm: parseFloat(customHeight) || 75,
    };
    const res = await fetch('/api/labels/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setError(data.error || `Label generation failed (${res.status})`);
      return null;
    }
    return data.zpl as string;
  }

  async function printOne(idx: number) {
    if (!ble.isConnected) { setError('Connect to a Zebra printer first'); return; }
    const seq = idx + 1;
    setPrinting(true);
    setPrintingSeq(seq);
    setError(null);
    try {
      const zpl = await fetchZpl(idx);
      if (!zpl) return;
      const ok = await ble.print(zpl);
      if (ok) {
        setPrintedSeqs(prev => new Set([...Array.from(prev), seq]));
      } else {
        setError(`Print failed for label ${seq}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
      setPrintingSeq(null);
    }
  }

  async function printAll() {
    if (!ble.isConnected) { setError('Connect to a Zebra printer first'); return; }
    setPrinting(true);
    setError(null);
    try {
      for (let i = 0; i < labels.length; i++) {
        const seq = i + 1;
        setPrintingSeq(seq);
        const zpl = await fetchZpl(i);
        if (!zpl) break;
        const ok = await ble.print(zpl);
        if (!ok) { setError(`Print failed for label ${seq}`); break; }
        setPrintedSeqs(prev => new Set([...Array.from(prev), seq]));
        if (i < labels.length - 1) await new Promise(r => setTimeout(r, 500));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setPrinting(false);
      setPrintingSeq(null);
    }
  }

  async function copyZpl(idx: number) {
    try {
      const zpl = await fetchZpl(idx);
      if (!zpl) return;
      await navigator.clipboard.writeText(zpl);
      setCopiedSeq(String(idx + 1));
      setTimeout(() => setCopiedSeq(null), 2000);
    } catch {
      setError('Failed to copy ZPL');
    }
  }

  async function copyAllZpl() {
    try {
      const all: string[] = [];
      for (let i = 0; i < labels.length; i++) {
        const zpl = await fetchZpl(i);
        if (zpl) all.push(zpl);
      }
      await navigator.clipboard.writeText(all.join('\n'));
      setCopiedSeq('all');
      setTimeout(() => setCopiedSeq(null), 2000);
    } catch {
      setError('Failed to copy ZPL');
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Custom Labels"
        subtitle={productName || 'Print any label'}
        showBack
        onBack={onBack}
      />

      <div className="px-4 pt-3 pb-1">
        <div className="flex gap-1.5">
          {(['config', 'print'] as Step[]).map((s, i) => {
            const labelsTab = ['1. Configure', '2. Print'];
            const isCurrent = step === s;
            const isReachable = s === 'config' || (s === 'print' && labels.length > 0);
            return (
              <button key={s} onClick={() => isReachable && setStep(s)}
                className={`flex-1 py-2 rounded-lg text-[var(--fs-xs)] font-bold text-center transition-all ${
                  isCurrent ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                {labelsTab[i]}
              </button>
            );
          })}
        </div>
      </div>

      {step === 'print' && (
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
               ble.status === 'scanning' ? 'Scanning…' :
               ble.status === 'connecting' ? 'Connecting…' : 'No printer connected'}
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
            <button onClick={() => setError(null)} className="ml-2 text-red-400 font-bold">{'✕'}</button>
          </div>
        </div>
      )}

      {step === 'config' && (
        <div className="px-4 pt-3 pb-24">
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-3">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
              Product name <span className="text-pink-500">*</span>
            </div>
            <input type="text" value={productName} onChange={e => setProductName(e.target.value)}
              placeholder="e.g. Jerk Sauce, Coleslaw, Pickled Onions"
              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] font-bold text-gray-900 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-3">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Quantity &amp; unit</div>
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="decimal" step="0.01" min="0"
                value={qty} onChange={e => setQty(e.target.value)} placeholder="0"
                className="flex-1 px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
              <input type="text" value={uom} onChange={e => setUom(e.target.value)} placeholder="kg"
                className="w-24 px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] font-bold text-gray-700 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Production date</div>
                <input type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] text-gray-900 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
              </div>
              <div>
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Expiry date</div>
                <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] text-gray-900 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Number of labels</div>
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="numeric" step="1" min="1" max="100"
                value={labelCount} onChange={e => setLabelCount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1"
                className="flex-1 px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-pink-600 focus:ring-2 focus:ring-pink-100 outline-none" />
              <span className="text-[var(--fs-sm)] font-bold text-gray-500 w-16">labels</span>
            </div>
          </div>

          <button onClick={handleGenerate} disabled={!canGenerate}
            className={`w-full py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg transition-all active:scale-[0.975] disabled:opacity-50 ${
              canGenerate ? 'bg-pink-600 text-white shadow-pink-600/30' : 'bg-gray-200 text-gray-400 shadow-none'
            }`}>
            Generate Labels{countNum > 0 ? ` (${countNum})` : ''}
          </button>
        </div>
      )}

      {step === 'print' && (
        <div className="px-4 pt-3 pb-24">
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-4">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-3">Label Preview</div>
            <div className="flex justify-center py-2 bg-gray-50 rounded-lg">
              <LabelPreview
                productName={productName || ' '}
                productionDate={fmtDate(productionDate)}
                qty={qtyNum}
                uom={uom}
                expiryDate={fmtDate(expiryDate)}
                lotName={labels[0]?.lotName}
                moName={labels[0]?.lotName}
                containerNumber={1}
                totalContainers={labels.length}
                widthMm={labelDims.widthMm}
                heightMm={labelDims.heightMm}
              />
            </div>
          </div>

          <LabelSizeSelector companyId={companyId} onSizeChange={handleSizeChange} />

          <div className="mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 px-1">
              {labels.length} Label{labels.length !== 1 ? 's' : ''} to print
            </div>
            {labels.map((row, idx) => {
              const seq = idx + 1;
              const isPrinted = printedSeqs.has(seq);
              const isPrintingThis = printingSeq === seq;
              const isCopied = copiedSeq === String(seq);
              return (
                <div key={idx} className={`bg-white border rounded-xl p-4 mb-2 flex items-center gap-3 ${
                  isPrinted ? 'border-green-200 bg-green-50/30' : isPrintingThis ? 'border-blue-200 bg-blue-50/20' : 'border-gray-200'
                }`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-[var(--fs-sm)] ${
                    isPrinted ? 'bg-green-500 text-white' : isPrintingThis ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isPrintingThis ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : isPrinted ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                    ) : seq}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{productName || '(no name)'}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 truncate">{row.lotName}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {ble.isConnected ? (
                      <button onClick={() => printOne(idx)} disabled={printing}
                        className={`text-[var(--fs-xs)] px-3 py-2 rounded-xl font-bold text-center disabled:opacity-40 ${
                          isPrinted ? 'bg-gray-100 text-gray-600 active:bg-gray-200' : 'bg-pink-600 text-white active:bg-pink-700 shadow-sm'
                        }`}>
                        {isPrintingThis ? '…' : isPrinted ? 'Reprint' : 'Print'}
                      </button>
                    ) : (
                      <button onClick={() => copyZpl(idx)}
                        className={`text-[var(--fs-xs)] px-3 py-2 rounded-xl font-bold text-center ${
                          isCopied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                        }`}>
                        {isCopied ? '✓ Copied' : 'Copy ZPL'}
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
              <button onClick={printAll} disabled={printing}
                className="flex-1 py-4 rounded-xl bg-pink-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-pink-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
                {printing ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Printing…
                  </span>
                ) : (
                  `Print All (${labels.length} labels)`
                )}
              </button>
            ) : (
              <button onClick={copyAllZpl}
                className={`flex-1 py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg active:scale-[0.975] transition-transform ${
                  copiedSeq === 'all' ? 'bg-green-100 text-green-700 shadow-none' : 'bg-gray-700 text-white shadow-gray-700/30'
                }`}>
                {copiedSeq === 'all' ? '✓ ZPL Copied to Clipboard' : `Copy All ZPL (${labels.length} labels)`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
