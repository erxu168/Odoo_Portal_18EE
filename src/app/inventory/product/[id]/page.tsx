'use client';

/**
 * Legacy redirect — the canonical product page moved to /products/[id] when
 * Products became its own module. Kept so links shipped before the move (and
 * any bookmarks) still resolve. Safe to delete once no old links remain.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LegacyProductRedirect({ params }: { params: { id: string } }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/products/${params.id}`);
  }, [params.id, router]);
  return null;
}
