'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  error?: string;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  footer?: React.ReactNode;
}

/** Full-screen 4-digit PIN pad (dark). Presentational: it collects a PIN and
 *  hands it to onSubmit on the 4th digit; the parent shows errors + does the work. */
export default function PinPad({ title, subtitle, error, busy, onSubmit, footer }: Props) {
  const [pin, setPin] = useState('');
  const tap = useCallback((d: string) => setPin(p => (p.length >= 4 ? p : p + d)), []);

  // Auto-submit on the 4th digit.
  useEffect(() => {
    if (pin.length === 4) onSubmit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Clear the entry whenever a new error arrives, so the next try starts fresh.
  useEffect(() => { if (error) setPin(''); }, [error]);

  return (
    <div className="fixed inset-0 z-[200] bg-[#1A1F2E] flex flex-col items-center justify-center px-6 text-white">
      <div className="text-center">
        <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-white/50">Kitchen Station</div>
        <div className="text-[var(--fs-xl)] font-bold mt-1">{title}</div>
        {subtitle && <div className="text-[var(--fs-sm)] text-white/60 mt-1">{subtitle}</div>}
      </div>

      <div className="flex items-center justify-center gap-3 my-6">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full transition-colors ${i < pin.length ? 'bg-white' : 'bg-white/20'}`} />
        ))}
      </div>

      <div className="text-[14px] text-red-300 font-semibold mb-4 min-h-[20px]">{error || ''}</div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-[300px]">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} disabled={busy} onClick={() => tap(d)}
            className="h-16 rounded-2xl bg-white/10 text-[26px] font-bold active:bg-white/20 disabled:opacity-50">{d}</button>
        ))}
        <div />
        <button disabled={busy} onClick={() => tap('0')}
          className="h-16 rounded-2xl bg-white/10 text-[26px] font-bold active:bg-white/20 disabled:opacity-50">0</button>
        <button onClick={() => setPin(p => p.slice(0, -1))}
          className="h-16 rounded-2xl text-white/70 active:bg-white/10 flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/></svg>
        </button>
      </div>

      {footer && <div className="mt-8">{footer}</div>}
    </div>
  );
}
