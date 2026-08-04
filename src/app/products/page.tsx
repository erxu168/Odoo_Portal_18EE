'use client';

/**
 * /products — the Products module home.
 *
 * A product is a first-class business record referenced by inventory, purchase,
 * POS and manufacturing, so it lives in its own module rather than inside
 * Inventory. This screen is the module's landing dashboard; the catalog list,
 * the batch photo grid and the setup queue are its own routes beneath it, so
 * each is linkable, refreshable and back-button-correct.
 *
 * Manager-gated. Individual products stay viewable by anyone through
 * drill-down to /products/[id].
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import ProductsDashboard, { type ProductsScreen } from '@/components/products/ProductsDashboard';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';

/** Where each tile goes. Kept here so the dashboard stays presentation-only. */
const DESTINATION: Record<ProductsScreen, string> = {
  catalog: '/products/catalog',
  photos: '/products/photos',
  untracked: '/products/catalog?gap=untracked',
  setup: '/products/setup',
  codes: '/products/codes',
};

export default function ProductsPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

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
        <AppHeader title="Products" subtitle="Catalog" showBack onBack={() => router.push('/')} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Manager access required</p>
          <p className="text-[var(--fs-sm)] text-gray-500 max-w-[260px]">You can still open any single product from a list or report to view its details.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Products" subtitle="Catalog" showBack onBack={() => router.push('/')} />
      <ProductsDashboard onNavigate={(screen) => router.push(DESTINATION[screen])} />
    </div>
  );
}
