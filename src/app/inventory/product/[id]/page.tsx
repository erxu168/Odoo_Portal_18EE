'use client';

/**
 * /inventory/product/[id] — a product's canonical Form View (its permanent
 * address). Part of the app-wide Universal Record Drill-Down standard: any
 * RecordLink to a product lands here. Deep-linkable (notifications, reports,
 * the back stack) and permission-aware — a user without edit capability sees
 * the same page read-only rather than an access wall.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/inventory/ui';
import ProductDetail from '@/components/inventory/ProductDetail';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';

// Next 14 passes route params as a plain object to client pages.
export default function ProductRecordPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  // Validate the WHOLE segment — "12junk" must not resolve to product 12.
  const productId = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;

  const [product, setProduct] = useState<any | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const back = () => (window.history.length > 1 ? router.back() : router.push('/inventory'));

  useEffect(() => {
    if (!Number.isInteger(productId) || productId <= 0) { setError('Invalid product'); setLoading(false); return; }
    (async () => {
      // Edit capability is resolved INDEPENDENTLY: an auth transport/parse
      // failure must degrade to read-only, never blank the whole product page.
      fetch('/api/auth/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const me = d?.user;
          const caps: string[] = Array.isArray(me?.capabilities)
            ? me.capabilities
            : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
          setCanEdit(caps.includes(RECORD_EDIT_CAP.product));
        })
        .catch(() => { /* stays read-only */ });

      try {
        const [pRes, imgRes] = await Promise.all([
          fetch(`/api/inventory/products?ids=${productId}&limit=1`),
          fetch('/api/inventory/product-images').catch(() => null),
        ]);
        if (!pRes.ok) throw new Error('Could not load the product');
        const p = (await pRes.json()).products?.[0];
        if (!p) throw new Error('Product not found');
        setProduct(p);
        try {
          const withImages: number[] = imgRes && imgRes.ok ? (await imgRes.json()).with_images || [] : [];
          setHasImage(withImages.includes(productId));
        } catch { /* thumbnail falls back to placeholder */ }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load the product');
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>;

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">{error || 'Product not found'}</p>
        <button onClick={back} className="mt-3 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Go back</button>
      </div>
    );
  }

  return (
    <ProductDetail
      product={product}
      hasImage={hasImage}
      readOnly={!canEdit}
      onClose={back}
      onChanged={() => { /* canonical page: no parent list to patch */ }}
    />
  );
}
