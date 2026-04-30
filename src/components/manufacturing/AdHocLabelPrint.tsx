'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import LabelPreview from '@/components/manufacturing/LabelPreview';
import LabelSizeSelector from '@/components/manufacturing/LabelSizeSelector';
import { useZebraBluetooth } from '@/hooks/useZebraBluetooth';
import { useCompany } from '@/lib/company-context';

interface AdHocLabelPrintProps {
  bomId: number;
  onBack: () => void;
  onDone: () => void;
}

interface ContainerRow {
  qty: string;
  expiryDate: string;
  lotName: string;
}

type Step = 'config' | 'print';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function calcExpiryDate(shelfLifeDays: number): string {
  const days = shelfLifeDays > 0 ? shelfLifeDays : 14;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateLotName(seq: number): string {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `LBL-${date}-${time}-${pad(seq)}`;
}

export default function AdHocLabelPrint({ bomId, onBack, onDone }: AdHocLabelPrintProps) {
  const { companyId } = useCompany();
  const [step, setStep] = useState<Step>('config');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [productName, setProductName] = useState('');
  const [productReference, setProductReference] = useState('');
  const [uom, setUom] = useState('kg');
  const [shelfLifeDays, setShelfLifeDays] = useState(0);

  const [qtyPerContainer, setQtyPerContainer] = useState('');
  const [labelCount, setLabelCount] = useState('1');
  const [expiryDate, setExpiryDate] = useState('');
  const [containers, setContainers] = useState<ContainerRow[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/boms/${bomId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.error) {
          setError(data.error || `Failed to load recipe (${res.status})`);
          return;
        }
        const bom = data.bom;
        const name = bom.product_tmpl_id?.[1] || 'Unknown';
        const u = bom.product_uom_id?.[1] || 'kg';
        const shelf = bom.shelf_life_days || 0;
        setProductName(name);
        setProductReference(bom.product_default_code || '');
        setUom(u);
        setShelfLifeDays(shelf);
        setExpiryDate(calcExpiryDate(shelf));
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recipe');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bomId]);

  const qtyNum = parseFloat(qtyPerContainer) || 0;
  const countNum = parseInt(labelCount, 10) || 0;
  const canGenerate = qtyNum > 0 && countNum > 0 && countNum <= 100 && !!expiryDate;

  function handleGenerate() {
    if (!canGenerate) return;
    setError(null);
    const rows: ContainerRow[] = [];
    for (let i = 0; i < countNum; i++) {
      rows.push({
        qty: qtyNum.toFixed(2),
        expiryDate,
        lotName: generateLotName(i + 1),
      });
    }
    setContainers(rows);
    setPrintedSeqs(new Set());
    setStep('print');
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);
  const fmtDate = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('de-DE');
  };

  async function fetchZpl(idx: number): Promise<string | null> {
    const c = containers[idx];
    const body = {
      productName,
      productReference: productReference || undefined,
      qty: parseFloat(c.qty),
      uom,
      productionDate: fmtDate(new Date().toISOString().slice(0, 10)),
      expiryDate: fmtDate(c.expiryDate),
      lotName: c.lotName,
      containerNumber: idx + 1,
      totalContainers: containers.length,
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

  async function printContainer(idx: number) {
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
        setError(`Print failed for container ${seq}`);
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
      for (let i = 0; i < containers.length; i++) {
        const seq = i + 1;
        setPrintingSeq(seq);
        const zpl = await fetchZpl(i);
        if (!zpl) break;
        const ok = await ble.print(zpl);
        if (!ok) { setError(`Print failed for container ${seq}`); break; }
        setPrintedSeqs(prev => new Set([...Array.from(prev), seq]));
        if (i < containers.length - 1) await new Promise(r => setTimeout(r, 500));
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
      for (let i = 0; i < containers.length; i++) {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-purple-600 rounded-full animate-spin" />
      </div>
    );
  }

  const previewIdx = 0;
  const previewContainer = containers[previewIdx];

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Label Print"
        subtitle={productName}
        showBack
        onBack={onBack}
      />

      <div className="px-4 pt-3 pb-1">
        <div className="flex gap-1.5">
          {(['config', 'print'] as Step[]).map((s, i) => {
            const labels = ['1. Configure', '2. Print'];
            const isCurrent = step === s;
            const isReachable = (s === 'config') || (s === 'print' && containers.length > 0);
            return (
              <button key={s} onClick={() => isReachable && setStep(s)}
                className={`flex-1 py-2 rounded-lg text-[var(--fs-xs)] font-bold text-center transition-all ${
                  isCurrent ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                {labels[i]}
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
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Quantity per container</div>
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="decimal" step="0.01" min="0"
                value={qtyPerContainer} onChange={e => setQtyPerContainer(e.target.value)}
                placeholder="0"
                className="flex-1 px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none" />
              <span className="text-[var(--fs-sm)] font-bold text-gray-500 w-10">{uom}</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-3">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Number of labels</div>
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="numeric" step="1" min="1" max="100"
                value={labelCount} onChange={e => setLabelCount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1"
                className="flex-1 px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-lg)] font-mono font-bold text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none" />
              <span className="text-[var(--fs-sm)] font-bold text-gray-500 w-16">labels</span>
            </div>
            {qtyNum > 0 && countNum > 0 && (
              <div className="mt-2.5 text-[var(--fs-xs)] text-gray-500">
                Total: {fmt(qtyNum * countNum)} {uom}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Expiry date</div>
            <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-base)] text-gray-900 focus:border-purple-600 focus:ring-2 focus:ring-purple-100 outline-none" />
            {shelfLifeDays > 0 && (
              <div className="mt-2.5 text-[var(--fs-xs)] text-gray-500">
                Shelf life: {shelfLifeDays} days
              </div>
            )}
          </div>

          <button onClick={handleGenerate} disabled={!canGenerate}
            className={`w-full py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg transition-all active:scale-[0.975] disabled:opacity-50 ${
              canGenerate ? 'bg-purple-600 text-white shadow-purple-600/30' : 'bg-gray-200 text-gray-400 shadow-none'
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
                productName={productName}
                productReference={productReference || undefined}
                productionDate={fmtDate(new Date().toISOString().slice(0, 10))}
                qty={parseFloat(previewContainer?.qty || '0') || 0}
                uom={uom}
                expiryDate={fmtDate(previewContainer?.expiryDate || '')}
                lotName={previewContainer?.lotName}
                moName={previewContainer?.lotName}
                containerNumber={1}
                totalContainers={containers.length}
                widthMm={labelDims.widthMm}
                heightMm={labelDims.heightMm}
              />
            </div>
          </div>

          <LabelSizeSelector companyId={companyId} onSizeChange={handleSizeChange} />

          <div className="mb-6">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 px-1">
              {containers.length} Container{containers.length !== 1 ? 's' : ''} to label
            </div>
            {containers.map((c, idx) => {
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
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900">{fmt(parseFloat(c.qty) || 0)} {uom}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                      {c.lotName} {'•'} Exp {fmtDate(c.expiryDate)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {ble.isConnected ? (
                      <button onClick={() => printContainer(idx)} disabled={printing}
                        className={`text-[var(--fs-xs)] px-3 py-2 rounded-xl font-bold text-center disabled:opacity-40 ${
                          isPrinted ? 'bg-gray-100 text-gray-600 active:bg-gray-200' : 'bg-purple-600 text-white active:bg-purple-700 shadow-sm'
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
                className="flex-1 py-4 rounded-xl bg-purple-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-purple-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
                {printing ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Printing…
                  </span>
                ) : (
                  `Print All (${containers.length} labels)`
                )}
              </button>
            ) : (
              <button onClick={copyAllZpl}
                className={`flex-1 py-4 rounded-xl font-bold text-[var(--fs-sm)] shadow-lg active:scale-[0.975] transition-transform ${
                  copiedSeq === 'all' ? 'bg-green-100 text-green-700 shadow-none' : 'bg-gray-700 text-white shadow-gray-700/30'
                }`}>
                {copiedSeq === 'all' ? '✓ ZPL Copied to Clipboard' : `Copy All ZPL (${containers.length} labels)`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
