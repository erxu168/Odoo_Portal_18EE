'use client';
/**
 * The tap-a-spot bottom sheet: identity + full path, the spot photo, and the
 * products stored here (thumbnail, category, and — for users who may edit
 * product pictures — a capture button that accepts camera, photo roll or
 * file, never capture-forced). "Spot details" links to the CANONICAL location
 * page; this sheet is a quick look, not a second editor.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { downscale } from '@/components/inventory/LocationForm';
import type { FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';

interface SheetProduct { id: number; name: string; category: string | null; hasImage: boolean }

interface SheetData {
  location: { id: number; name: string; kind: string; photo: string | null };
  path: string;
  anchor: { floorId: number; cx: number; cy: number } | null;
  products: SheetProduct[] | null;
  productsUnavailable: boolean;
}

interface Props {
  locationId: number;
  typesByKey: Record<string, FloorplanTypeInfo>;
  canEditProductPhotos: boolean;
  onClose: () => void;
}

export default function FloorplanSpotSheet({ locationId, typesByKey, canEditProductPhotos, onClose }: Props) {
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [imageBust, setImageBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingProductRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    setData(null);
    setError(null);
    fetch(`/api/inventory/floorplan/spots/${locationId}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (tokenRef.current !== token) return; // stale response — a newer spot is loading
        if (!ok) setError(d.error ?? 'Could not load this spot');
        else setData(d as SheetData);
      })
      .catch(() => { if (tokenRef.current === token) setError('Could not load this spot — check your connection'); });
  }, [locationId, imageBust]);

  const type = data ? typesByKey[data.location.kind] : undefined;

  const startPhoto = (productId: number) => {
    pendingProductRef.current = productId;
    fileRef.current?.click();
  };

  const onFile = async (file: File | null) => {
    const productId = pendingProductRef.current;
    pendingProductRef.current = null;
    if (!file || productId == null) return;
    setPhotoBusy(productId);
    try {
      const dataUrl = await downscale(file);
      const res = await fetch(`/api/inventory/product-images/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Could not save the photo');
      } else {
        setImageBust(b => b + 1); // reload sheet — thumbnail appears
      }
    } catch {
      setError('Could not read that photo');
    } finally {
      setPhotoBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <BottomSheet
      title={data ? data.location.name : 'Loading…'}
      onClose={onClose}
    >
      {/* camera + photo roll + files — no capture attribute, ever */}
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => onFile(e.target.files?.[0] ?? null)}
      />
      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</div>
      )}
      {!data && !error && <div className="py-6 text-center text-[13px] text-gray-500">Loading…</div>}
      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[12.5px] text-gray-500">
            <span className="truncate">{data.path}</span>
            {type && (
              <span
                className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white"
                style={{ background: type.color }}
              >
                {type.icon} {type.label}
              </span>
            )}
          </div>

          {data.location.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.location.photo} alt={`Photo of ${data.location.name}`} className="max-h-40 w-full rounded-2xl object-cover" />
          ) : (
            <div className="flex h-16 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-[12px] font-medium text-gray-400">
              📷 No spot photo yet — add one on the spot’s page
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">STORED HERE</p>
            {data.productsUnavailable && (
              <p className="py-2 text-[12.5px] text-amber-700">
                Product details are unavailable right now (no connection to the product catalog) — the spot itself is unaffected.
              </p>
            )}
            {!data.productsUnavailable && data.products && data.products.length === 0 && (
              <p className="py-2 text-[12.5px] text-gray-500">No products assigned yet — assign them in Inventory and they’ll show here.</p>
            )}
            {!data.productsUnavailable && data.products && data.products.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                {data.products.map(p => (
                  <div key={p.id} className="flex min-h-[44px] items-center gap-2.5 border-b border-gray-50 py-1.5 last:border-b-0">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-[15px]">
                      {p.hasImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/inventory/product-images/${p.id}?v=${imageBust}`} alt="" className="h-full w-full object-cover" />
                      ) : '📦'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-gray-900">{p.name}</span>
                      <span className="block text-[10.5px] font-semibold text-gray-500">{p.category ?? 'Product'}</span>
                    </span>
                    {canEditProductPhotos && (
                      <button
                        onClick={() => startPhoto(p.id)}
                        disabled={photoBusy === p.id}
                        aria-label={`Add a photo of ${p.name}`}
                        className="h-9 w-9 flex-shrink-0 rounded-lg border-[1.5px] border-gray-200 bg-white text-[14px] active:scale-95 disabled:opacity-50"
                      >
                        {photoBusy === p.id ? '…' : '📷'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => router.push(`/inventory/location/${data.location.id}`)}
            className="h-11 w-full rounded-full bg-green-600 text-[14px] font-bold text-white active:scale-[0.98]"
          >
            Spot details
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
