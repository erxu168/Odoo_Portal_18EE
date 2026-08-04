'use client';

/**
 * /products/codes — give products that have no barcode a house code, so their
 * shelf label can actually be scanned. Manager-gated like the rest of Products.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import BulkProductCodes from '@/components/products/BulkProductCodes';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';

export default function ProductCodesPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const keys = allowedActionKeysForRole(((d?.user?.role || d?.role || 'staff') as Role), {});
        setState(keys.includes('inventory.productsettings.manage') ? 'ok' : 'denied');
      })
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Product codes" subtitle="For shelf labels" showBack onBack={() => router.push('/products')} />
      {state === 'denied' ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Manager access required</p>
        </div>
      ) : (
        <BulkProductCodes />
      )}
    </div>
  );
}
