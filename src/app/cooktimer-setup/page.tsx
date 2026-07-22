'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import CookSetupClient from '@/components/cooktimer/setup/CookSetupClient';

const CAP = 'cooktimer.config.manage';

/** Manager-only Cooking Timer setup (stations + cook profiles). Light portal
 *  standard — lives OUTSIDE /cooktimer (which is the dark immersive tablet tool).
 *  Client capability guard mirrors the API's server-side gate (defense in depth). */
export default function CookTimerSetupPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const me = d?.user;
        const caps: string[] = Array.isArray(me?.capabilities)
          ? me.capabilities
          : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
        setState(caps.includes(CAP) ? 'ok' : 'denied');
      })
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') {
    return <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (state === 'denied') {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-4xl">🔒</div>
        <div className="text-lg font-bold text-gray-800">Manager access required</div>
        <div className="text-sm text-gray-500">The Cooking Timer setup is available to managers and admins.</div>
        <button onClick={() => router.push('/')} className="mt-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold">Back to home</button>
      </div>
    );
  }
  return <CookSetupClient />;
}
