'use client';

import React, { useState, useEffect } from 'react';

interface NumpadModalProps {
  open: boolean;
  productName: string;
  category: string;
  uom: string;
  initialValue: number | null;
  showSystemQty: boolean;
  systemQty: number | null;
  locationName: string;
  onSave: (value: number | null) => void;
  onClose: () => void;
}

export default function NumpadModal({
  open, productName, category, uom, initialValue,
  showSystemQty, systemQty, locationName, onSave, onClose,
}: NumpadModalProps) {
  const [buf, setBuf] = useState('');

  useEffect(() => {
    if (open) {
      setBuf(initialValue !== null && initialValue !== undefined ? String(initialValue) : '');
    }
  }, [open, initialValue]);

  if (!open) return null;

  function press(key: string) {
    setBuf((b) => {
      if (key === 'del') return b.slice(0, -1);
      if (key === '.') return b.includes('.') ? b : (b === '' ? '0.' : b + '.');
      if (b === '0' && key !== '.') return key;
      return b + key;
    });
  }

  function handleSave() {
    if (buf === '' || buf === '0') {
      onSave(null);
    } else {
      const v = parseFloat(buf);
      onSave(isNaN(v) ? null : v);
    }
  }

  const displayVal = buf || '0';
  const isEmpty = !buf || buf === '0';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onClose} className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          <span className="text-[var(--fs-xs)] font-semibold px-2.5 py-0.5 rounded-md bg-green-50 text-green-700">{locationName}</span>
        </div>
      </div>

      {/* Product info */}
      <div className="text-center py-5 px-4">
        <div className="text-[18px] font-bold text-gray-900">{productName}</div>
        <div className="text-[var(--fs-base)] text-gray-500 mt-1">{category}</div>
        {showSystemQty && (
          <div className="text-[var(--fs-sm)] text-gray-400 mt-2">
            System qty: <span className="font-mono font-medium text-gray-500">{systemQty ?? '--'}</span>
          </div>
        )}
      </div>

      {/* Value display */}
      <div className="text-center px-4 pb-2">
        <div className={`font-mono text-[48px] font-semibold tracking-tight ${isEmpty ? 'text-gray-300' : 'text-gray-900'}`}>
          {displayVal}
        </div>
        <div className="text-[14px] text-gray-500 mt-1">{uom}</div>
      </div>

      {/* Numpad */}
      <div className="mt-auto px-5 pb-4">
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1','2','3','4','5','6','7','8','9','.','0','del'].map((key) => (
            <button key={key} onClick={() => press(key)}
              className={`h-14 rounded-xl font-mono text-xl font-medium flex items-center justify-center select-none transition-colors ${
                key === 'del'
                  ? 'bg-gray-100 text-gray-600 active:bg-gray-200'
                  : 'bg-white border border-gray-200 text-gray-900 active:bg-gray-100 shadow-sm'
              }`}>
              {key === 'del' ? (
                <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
                  <path d="M8 5L3 11L8 17H19V5H8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 9L16 13M16 9L12 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : key}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setBuf('')}
            className="w-20 h-14 rounded-xl border border-gray-200 bg-white text-gray-500 text-[14px] font-semibold active:bg-gray-50">
            Clear
          </button>
          <button onClick={handleSave}
            className="flex-1 h-14 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.98] transition-all">
            Save count
          </button>
        </div>
      </div>
    </div>
  );
}
