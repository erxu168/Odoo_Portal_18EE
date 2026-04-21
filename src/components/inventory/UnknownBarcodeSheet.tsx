'use client';

import React, { useEffect, useRef, useState } from 'react';
import PhotoCaptureStrip from './PhotoCaptureStrip';

interface UnknownBarcodeSheetProps {
  barcode: string;
  onCancel: () => void;
  onCreated: (product: any, qty: number, photos: string[]) => void;
  /** When true, renders as a centered modal with a dark backdrop
   *  (standalone use). When false, renders as a bottom sheet relative
   *  to a parent (nested inside BarcodeScanner overlay). */
  standalone?: boolean;
}

/**
 * Prompt to create a new (draft) product for an unknown barcode. Posts
 * to /api/inventory/products and calls onCreated with the created
 * product, the captured qty, and [front, back] package photos. The
 * parent decides what to do next (add to count batch, attach photos
 * to the count line, etc.).
 */
export default function UnknownBarcodeSheet({ barcode, onCancel, onCreated, standalone = false }: UnknownBarcodeSheetProps) {
  const [name, setName] = useState('');
  const [qtyValue, setQtyValue] = useState(1);
  const [frontPhotos, setFrontPhotos] = useState<string[]>([]);
  const [backPhotos, setBackPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    if (frontPhotos.length === 0 || backPhotos.length === 0) {
      setError('Please take a front and back photo of the package');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create');
        setSubmitting(false);
        return;
      }
      onCreated(data.product, qtyValue, [...frontPhotos, ...backPhotos]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  const sheet = (
    <div className={standalone
      ? 'fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp'
      : 'absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp'}>
      <div className="mb-3">
        <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1">New product</p>
        <p className="text-[12px] text-gray-500 font-mono">{barcode}</p>
      </div>

      <label className="text-[13px] font-semibold text-gray-600 mb-2 block">What is this item?</label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Pork belly"
        className="w-full px-4 py-3 rounded-xl bg-gray-50 border-2 border-gray-200 text-[16px] text-gray-900 focus:outline-none focus:border-[#F5800A] mb-4"
        disabled={submitting}
      />

      <div className="mb-4">
        <label className="text-[13px] font-semibold text-gray-600 mb-2 block">
          Package photo — front <span className="text-red-500">*</span>
        </label>
        <PhotoCaptureStrip
          photos={frontPhotos}
          onChange={setFrontPhotos}
          max={1}
          disabled={submitting}
        />
      </div>

      <div className="mb-4">
        <label className="text-[13px] font-semibold text-gray-600 mb-2 block">
          Package photo — back <span className="text-red-500">*</span>
        </label>
        <PhotoCaptureStrip
          photos={backPhotos}
          onChange={setBackPhotos}
          max={1}
          disabled={submitting}
        />
      </div>

      <label className="text-[13px] font-semibold text-gray-600 mb-2 block">Quantity</label>
      <div className="flex items-center justify-center gap-4 mb-5">
        <button
          onClick={() => setQtyValue((q) => Math.max(0, q - 1))}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >&minus;</button>
        <input
          type="text"
          inputMode="decimal"
          value={qtyValue}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '');
            if (v === '' || v === '.') { setQtyValue(0); return; }
            const n = parseFloat(v);
            if (!isNaN(n)) setQtyValue(n);
          }}
          className="w-24 h-14 text-center text-[32px] font-mono font-bold text-gray-900 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#F5800A]"
          disabled={submitting}
        />
        <button
          onClick={() => setQtyValue((q) => q + 1)}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >+</button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200 disabled:opacity-50"
        >Cancel</button>
        <button
          onClick={handleCreate}
          disabled={submitting || name.trim().length < 2 || frontPhotos.length === 0 || backPhotos.length === 0}
          className="flex-[2] py-3.5 rounded-xl bg-[#F5800A] text-white text-[15px] font-bold shadow-md shadow-[#F5800A]/30 active:bg-[#E86000] active:scale-[0.975] transition-all disabled:opacity-40"
        >{submitting ? 'Creating...' : 'Create and count'}</button>
      </div>
    </div>
  );

  if (!standalone) return sheet;
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end justify-center" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full">
        {sheet}
      </div>
    </div>
  );
}
