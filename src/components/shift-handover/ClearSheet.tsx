'use client';

import React, { useState } from 'react';
import { Sheet, PrimaryButton, parseAmount } from './common';
import type { StorageRow } from './StorageTray';

const REASONS = [
  { key: 'used_up', label: 'Used up', emoji: '✅' },
  { key: 'moved_out', label: 'Moved out', emoji: '↗️' },
  { key: 'discarded', label: 'Discarded', emoji: '🗑️' },
];

/**
 * "What happened to it?" — pick an outcome, then say whether it was all of the
 * item or just some. "Just some" reduces the amount and leaves the rest in the
 * tray; "All of it" clears the whole item.
 */
export function ClearSheet({ item, onClose, onSubmit }: {
  item: StorageRow; onClose: () => void; onSubmit: (reason: string, amount?: number, idemKey?: string) => void;
}) {
  const [reason, setReason] = useState('used_up');
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Stable per open, so a stray double-fire dedupes server-side instead of double-counting.
  const [idemKey] = useState(() => `clear-${item.id}-${Math.random().toString(36).slice(2)}`);

  const hasAmount = item.amount != null && !!item.unit;
  const have = item.amount;
  const someAmt = parseAmount(amount);
  const overMax = mode === 'some' && have != null && someAmt > have;
  const someInvalid = mode === 'some' && (!(Number.isFinite(someAmt) && someAmt > 0) || overMax);

  function confirm() {
    if (submitting || someInvalid) return;
    setSubmitting(true);
    if (mode === 'some' && hasAmount) onSubmit(reason, someAmt, idemKey);
    else onSubmit(reason, undefined, idemKey);
  }

  const footerLabel = mode === 'some' && amount ? `Log ${amount} ${item.unit || ''} ${labelFor(reason)}`.trim() : 'Confirm';

  return (
    <Sheet title={`${item.name} — what happened?`} onClose={onClose}
      footer={<PrimaryButton onClick={confirm} busy={submitting} disabled={someInvalid}>{footerLabel}</PrimaryButton>}>

      {hasAmount && (
        <p className="text-[var(--fs-sm)] text-gray-500 mb-3">In storage: <b className="text-gray-800">{item.amount} {item.unit}</b></p>
      )}

      <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">What happened?</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {REASONS.map((r) => {
          const on = reason === r.key;
          return (
            <button key={r.key} type="button" onClick={() => setReason(r.key)}
              className={`rounded-2xl border px-1.5 py-3 text-center active:scale-95 transition-transform ${on ? 'bg-green-50 border-green-600 ring-1 ring-green-600' : 'bg-white border-gray-200'}`}>
              <div className="text-[20px] leading-none">{r.emoji}</div>
              <div className={`text-[var(--fs-xs)] mt-1.5 leading-tight ${on ? 'text-green-800 font-bold' : 'text-gray-600 font-medium'}`}>{r.label}</div>
            </button>
          );
        })}
      </div>

      {hasAmount && (
        <>
          <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">How much?</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button type="button" onClick={() => setMode('all')} className={`h-11 rounded-xl border font-semibold text-[var(--fs-sm)] ${mode === 'all' ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-700'}`}>All of it</button>
            <button type="button" onClick={() => setMode('some')} className={`h-11 rounded-xl border font-semibold text-[var(--fs-sm)] ${mode === 'some' ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-700'}`}>Just some</button>
          </div>
          {mode === 'some' && (
            <>
              <div className="flex items-center gap-2 mt-1">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus placeholder="Amount"
                  className={`flex-1 bg-gray-50 border rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none ${overMax ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-green-600'}`} />
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">{item.unit}</span>
                <span className="text-[var(--fs-xs)] text-gray-400">of {item.amount}</span>
              </div>
              {overMax && <p className="text-[var(--fs-xs)] text-red-600 mt-1.5">Only {item.amount} {item.unit} in storage — use “All of it” to clear the lot.</p>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function labelFor(reason: string): string {
  return reason === 'moved_out' ? 'moved out' : reason === 'discarded' ? 'discarded' : 'used';
}
