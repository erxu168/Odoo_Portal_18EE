'use client';

import React, { useEffect, useState } from 'react';
import { useShift } from '@/lib/shift-context';

/**
 * Shown only on a "Shared device" account. The bar itself; the name+PIN sheet
 * lives in ShiftProvider (via useShift().openSignIn) so it can also be summoned
 * as a "prompt when it matters" gate from other screens.
 */
export default function WorkingAsBanner() {
  const { activePerson, openSignIn } = useShift();
  const [isShared, setIsShared] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.is_shared_device) setIsShared(true); }).catch(() => {});
  }, []);

  if (!isShared) return null;

  return (
    <button onClick={() => openSignIn()} className="w-full flex items-center gap-2 px-4 py-2 bg-[#1A1F2E] text-white text-[13px] active:bg-[#232838]">
      <span className={`w-2 h-2 rounded-full ${activePerson ? 'bg-[#16A34A]' : 'bg-amber-400 animate-pulse'}`} />
      {activePerson
        ? <span>Working as <b className="font-bold">{activePerson.name}</b></span>
        : <span className="text-amber-300 font-semibold">Tap to sign in for your shift</span>}
      <span className="ml-auto text-white/50 text-[12px] font-semibold">{activePerson ? 'Switch' : 'Sign in'}</span>
    </button>
  );
}
