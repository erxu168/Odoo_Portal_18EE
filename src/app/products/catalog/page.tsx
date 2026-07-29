'use client';

/**
 * /products/catalog — the product list.
 *
 * Its own route rather than a mode of /products, so the back button behaves,
 * a refresh keeps you where you were, and a dashboard tile can hand over with
 * a filter already applied (?gap=untracked) instead of dropping you at the top
 * of an unfiltered list to find it yourself.
 *
 *   ?gap=untracked|spot|pack|photo|picture   land with that filter selected
 */
import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import ProductSettings, { type ProductGap } from '@/components/inventory/ProductSettings';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';

const GAPS: ProductGap[] = ['untracked', 'spot', 'pack', 'photo', 'picture'];

function CatalogScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  // A URL is user input: anything not in the known set is ignored rather than
  // passed through to become a filter that matches nothing.
  const rawGap = params.get('gap');
  const gap = GAPS.includes(rawGap as ProductGap) ? (rawGap as ProductGap) : null;

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
        <AppHeader title="Products" showBack onBack={() => router.push('/products')} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Manager access required</p>
          <p className="text-[var(--fs-sm)] text-gray-500 max-w-[260px]">You can still open any single product from a list or report to view its details.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <ProductSettings
        initialGap={gap}
        title="All products"
        onBack={() => router.push('/products')}
      />
    </div>
  );
}

export default function ProductCatalogPage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>}>
      <CatalogScreen />
    </Suspense>
  );
}
