'use client';

import React from 'react';

/** Shown on a provisioned tablet whose access a manager has turned OFF. */
export default function TabletOff({ companyName, onManager }: { companyName: string; onManager: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] bg-[#1A1F2E] flex flex-col items-center justify-center px-6 text-white text-center">
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-white/50">Kitchen Station</div>
      <div className="text-[var(--fs-xl)] font-bold mt-1">{companyName || 'This tablet'}</div>
      <div className="mt-8 w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
      </div>
      <div className="text-[var(--fs-md)] font-semibold mt-4">This tablet is turned off</div>
      <div className="text-[var(--fs-sm)] text-white/60 mt-1">Ask a manager to turn it back on.</div>
      <button onClick={onManager} className="mt-10 text-white/40 text-[12px] font-semibold active:text-white/70">
        Manager setup
      </button>
    </div>
  );
}
