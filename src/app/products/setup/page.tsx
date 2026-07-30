'use client';

/**
 * /products/setup — the products waiting to be finished.
 *
 * Its own route so the dashboard tile has somewhere real to go, the back button
 * behaves, and a manager can be sent the link.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import SetupQueue from '@/components/products/SetupQueue';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';

export default function ProductSetupPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  const back = () => router.push('/products');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const me = d?.user;
        const caps: string[] = Array.isArray(me?.capabilities)
          ? me.capabilities
          : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
        setState(caps.includes(RECORD_EDIT_CAP.product) ? 'ok' : 'denied');
      })
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>;

  if (state === 'denied') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader title="Needs setup" showBack onBack={back} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Manager access required</p>
          <p className="text-[var(--fs-sm)] text-gray-500 max-w-[260px]">Ask a manager to finish the products scanned during counts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SetupQueue onBack={back} />
    </div>
  );
}
