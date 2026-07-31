'use client';
/**
 * The tap-a-spot bottom sheet: identity + full path, the spot photo, and the
 * products stored here (thumbnail, category, and — for users who may edit
 * product pictures — a capture button that accepts camera, photo roll or
 * file, never capture-forced). "Spot details" links to the CANONICAL location
 * page; this sheet is a quick look, not a second editor.
 */
import { useEffect, useRef, useState } from 'react';
import DropZone from '@/components/ui/DropZone';
import { useRouter } from 'next/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { downscale } from '@/components/inventory/LocationForm';
import type { FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';

interface SheetProduct { id: number; name: string; category: string | null; hasImage: boolean }

interface SheetChild { id: number; name: string; kind: string; productCount: number }

interface SheetData {
  location: { id: number; name: string; kind: string; photo: string | null };
  path: string;
  anchor: { floorId: number; cx: number; cy: number } | null;
  children: SheetChild[];
  products: SheetProduct[] | null;
  productsUnavailable: boolean;
}

interface Props {
  locationId: number;
  typesByKey: Record<string, FloorplanTypeInfo>;
  canEditProductPhotos: boolean;
  /** inventory.location.manage — enables the spot-photo capture right here. */
  canEditSpotPhoto?: boolean;
  /** May assign products to this spot (the walk-through flow). */
  canAssignProducts?: boolean;
  /** Drill into something INSIDE this place (a fridge's drawers). */
  onOpenLocation?: (locationId: number) => void;
  onClose: () => void;
}

interface CatalogProduct { id: number; name: string }

export default function FloorplanSpotSheet({ locationId, typesByKey, canEditProductPhotos, canEditSpotPhoto, canAssignProducts, onOpenLocation, onClose }: Props) {
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [imageBust, setImageBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const spotPhotoRef = useRef<HTMLInputElement>(null);
  const [spotPhotoBusy, setSpotPhotoBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogProduct[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assignBusy, setAssignBusy] = useState(false);
  const [catalogDown, setCatalogDown] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levels, setLevels] = useState({ count: 4, word: 'Level' });
  const [levelsBusy, setLevelsBusy] = useState(false);
  const searchTokenRef = useRef(0);
  const pendingProductRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    setData(null);
    setError(null);
    // Drilling from one spot into another keeps this component mounted, so any
    // panel left open would carry over — including onto a marker, where those
    // actions do not exist.
    setLevelsOpen(false);
    setAssignOpen(false);
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

  // Catalog search for the assign panel (debounced, newest response wins).
  useEffect(() => {
    if (!assignOpen) return;
    const q = query.trim();
    const token = ++searchTokenRef.current;
    const t = setTimeout(() => {
      const url = q.length >= 2
        ? `/api/inventory/products?search=${encodeURIComponent(q)}&limit=40`
        : '/api/inventory/products?limit=40';
      fetch(url)
        .then(async (r): Promise<{ ok: boolean; d: { products?: CatalogProduct[] } | null }> =>
          r.ok ? { ok: true, d: await r.json() } : { ok: false, d: null })
        .then(({ ok, d }) => {
          if (searchTokenRef.current !== token) return;
          setCatalogDown(!ok);
          setResults(ok ? (d?.products ?? []) : []);
        })
        .catch(() => {
          if (searchTokenRef.current !== token) return;
          setCatalogDown(true);   // "can't reach the catalog" ≠ "nothing found"
          setResults([]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [assignOpen, query]);

  const alreadyHere = new Set((data?.products ?? []).map(p => p.id));

  /**
   * A MARKER, not a place: a shut-off valve, a fuse box. It marks the thing
   * itself, so there is nothing to store in it and nothing to nest inside it —
   * both offers are withdrawn rather than left to fail later.
   */
  const markerOnly = !!typesByKey[data?.location.kind ?? '']?.markerOnly;
  const canHoldThings = !!canAssignProducts && !markerOnly;

  const addLevels = async () => {
    if (!data) return;
    setLevelsBusy(true);
    try {
      const res = await fetch(`/api/inventory/floorplan/spots/${data.location.id}/children`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: levels.count, labelPattern: levels.word, typeKey: 'shelf' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? 'Could not add the levels'); return; }
      setLevelsOpen(false);
      setImageBust(b => b + 1); // reload — they appear under INSIDE
    } catch {
      setError('Could not add the levels — check your connection');
    } finally {
      setLevelsBusy(false);
    }
  };

  const saveAssignment = async () => {
    if (!data) return;
    const add = Array.from(picked).filter(id => !alreadyHere.has(id));
    const remove = Array.from(alreadyHere).filter(id => !picked.has(id));
    if (add.length === 0 && remove.length === 0) { setAssignOpen(false); return; }
    setAssignBusy(true);
    try {
      const res = await fetch(`/api/inventory/floorplan/spots/${data.location.id}/products`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add, remove }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? 'Could not save'); return; }
      setAssignOpen(false);
      setQuery('');
      setImageBust(b => b + 1); // reload the sheet — the list updates in place
    } catch {
      setError('Could not save — check your connection');
    } finally {
      setAssignBusy(false);
    }
  };

  const saveSpotPhoto = async (file: File | null | undefined) => {
    if (!file || !data) return;
    setSpotPhotoBusy(true);
    try {
      const dataUrl = await downscale(file);
      const res = await fetch('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.location.id, photo: dataUrl }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not save the photo');
      else setImageBust(b => b + 1); // reload — the new photo appears in place
    } catch {
      setError('Could not read that photo');
    } finally {
      setSpotPhotoBusy(false);
      if (spotPhotoRef.current) spotPhotoRef.current.value = '';
    }
  };

  // Paste support (house rule: camera + roll + file + drag + paste).
  useEffect(() => {
    if (!canEditSpotPhoto) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'));
      if (file) void saveSpotPhoto(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditSpotPhoto, data?.location.id]);

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
          <div className="flex items-start gap-2 text-[12.5px] text-gray-500">
            {/* The full path, never clipped — a shelf is identified by the path
                that leads to it, so "…" is the one part you cannot lose. */}
            <span className="min-w-0 break-words">{data.path}</span>
            {type && (
              <span
                className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white"
                style={{ background: type.color }}
              >
                {type.icon} {type.label}
              </span>
            )}
          </div>

          <div
            onDragOver={canEditSpotPhoto ? e => e.preventDefault() : undefined}
            onDrop={canEditSpotPhoto ? e => { e.preventDefault(); void saveSpotPhoto(e.dataTransfer.files?.[0]); } : undefined}
            onClick={canEditSpotPhoto ? () => spotPhotoRef.current?.click() : undefined}
            role={canEditSpotPhoto ? 'button' : undefined}
            aria-label={canEditSpotPhoto ? `Add a photo of ${data.location.name}` : undefined}
            className={canEditSpotPhoto ? 'cursor-pointer' : undefined}
          >
            <input ref={spotPhotoRef} type="file" accept="image/*" className="hidden" onChange={e => void saveSpotPhoto(e.target.files?.[0])} />
            {data.location.photo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.location.photo} alt={`Photo of ${data.location.name}`} className="max-h-40 w-full rounded-2xl object-cover" />
                {canEditSpotPhoto && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-gray-900/75 px-2.5 py-1 text-[10.5px] font-bold text-white">
                    {spotPhotoBusy ? 'Saving…' : '📷 Replace'}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex h-16 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-[12px] font-medium text-gray-400">
                {canEditSpotPhoto
                  ? (spotPhotoBusy ? 'Saving…' : '📷 Add a photo — tap, drop or paste')
                  : '📷 No spot photo yet'}
              </div>
            )}
          </div>

          {canHoldThings && !levelsOpen && (
            <button
              onClick={() => setLevelsOpen(true)}
              className="h-11 w-full rounded-full border-[1.5px] border-gray-200 text-[13px] font-bold text-gray-700 active:scale-[0.98]"
            >
              ＋ Add levels / drawers inside
            </button>
          )}
          {canHoldThings && levelsOpen && (
            <div className="rounded-2xl border border-gray-200 p-3">
              <p className="mb-2 text-[12px] font-semibold text-gray-600">
                Numbered places inside {data.location.name} — no extra markers needed.
              </p>
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={levels.word}
                  onChange={e => setLevels(l => ({ ...l, word: e.target.value }))}
                  aria-label="What are they called"
                  className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] font-semibold outline-none focus:border-blue-600"
                />
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={levels.count}
                  onChange={e => setLevels(l => ({ ...l, count: Math.min(40, Math.max(1, Number(e.target.value) || 1)) }))}
                  aria-label="How many"
                  className="h-11 w-20 rounded-xl border-[1.5px] border-gray-200 px-3 text-center text-[14px] font-bold outline-none focus:border-blue-600"
                />
              </div>
              <p className="mb-2 text-[11.5px] text-gray-500">
                Creates {levels.word} 1 … {levels.word} {levels.count} inside this place.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setLevelsOpen(false)} className="h-11 flex-1 rounded-full border-[1.5px] border-gray-200 text-[13.5px] font-bold text-gray-700">Cancel</button>
                <button onClick={addLevels} disabled={levelsBusy} className="h-11 flex-1 rounded-full bg-green-600 text-[13.5px] font-bold text-white disabled:opacity-50">
                  {levelsBusy ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {(data.children?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">
                INSIDE ({data.children.length})
              </p>
              <div className="max-h-40 overflow-y-auto">
                {data.children.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onOpenLocation?.(c.id)}
                    className="flex min-h-[44px] w-full items-center gap-2.5 border-b border-gray-50 py-1.5 text-left last:border-b-0 active:bg-gray-50"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[14px]">
                      {typesByKey[c.kind]?.icon ?? '📦'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">{c.name}</span>
                    <span className="flex-shrink-0 text-[11px] font-semibold text-gray-500">
                      {c.productCount > 0 ? `${c.productCount} product${c.productCount === 1 ? '' : 's'}` : 'empty'}
                    </span>
                    <span className="flex-shrink-0 text-gray-300">›</span>
                  </button>
                ))}
              </div>
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
                      // Drop onto the row itself, not just the button — a 36px
                      // target is not a drop target. Routed through the same
                      // pendingProductRef the picker uses, so the photo lands on
                      // the right product either way.
                      <DropZone
                        onFiles={(fs) => { if (fs[0]) { pendingProductRef.current = p.id; onFile(fs[0]); } }}
                        disabled={photoBusy === p.id}
                        hint={`Drop a photo of ${p.name}`}
                      >
                      <button
                        onClick={() => startPhoto(p.id)}
                        disabled={photoBusy === p.id}
                        aria-label={`Add a photo of ${p.name}`}
                        className="h-9 w-9 flex-shrink-0 rounded-lg border-[1.5px] border-gray-200 bg-white text-[14px] active:scale-95 disabled:opacity-50"
                      >
                        {photoBusy === p.id ? '…' : '📷'}
                      </button>
                      </DropZone>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canHoldThings && !assignOpen && (
            <button
              onClick={() => {
                setPicked(new Set((data.products ?? []).map(p => p.id)));
                setResults(null);
                setAssignOpen(true);
              }}
              className="h-11 w-full rounded-full border-[1.5px] border-blue-600 text-[13.5px] font-bold text-blue-600 active:scale-[0.98]"
            >
              + Assign products here
            </button>
          )}

          {canHoldThings && assignOpen && (
            <div className="rounded-2xl border border-gray-200 p-3">
              <p className="mb-2 text-[12px] font-semibold text-gray-600">
                Tick everything stored at {data.location.name}. A product can live in several places.
              </p>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search your products…"
                aria-label="Search products"
                className="mb-2 h-11 w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] outline-none focus:border-blue-600"
              />
              <div className="max-h-52 overflow-y-auto">
                {results === null && <p className="py-3 text-center text-[12.5px] text-gray-500">Loading…</p>}
                {results?.length === 0 && (
                  <p className="py-3 text-center text-[12.5px] text-gray-500">
                    {catalogDown
                      ? 'The product list is unavailable right now — check the connection and try again.'
                      : `Nothing found${query.trim() ? ` for “${query.trim()}”` : ''}.`}
                  </p>
                )}
                {results?.map(p => {
                  const on = picked.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPicked(prev => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                        return next;
                      })}
                      className="flex min-h-[44px] w-full items-center gap-2.5 border-b border-gray-50 px-1 py-1.5 text-left last:border-b-0"
                    >
                      <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white ${on ? 'bg-green-600' : 'bg-gray-200'}`}>
                        {on ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">{p.name}</span>
                      {alreadyHere.has(p.id) && !on && <span className="flex-shrink-0 text-[10.5px] font-bold text-red-500">removing</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setAssignOpen(false); setQuery(''); }}
                  className="h-11 flex-1 rounded-full border-[1.5px] border-gray-200 text-[13.5px] font-bold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAssignment}
                  disabled={assignBusy}
                  className="h-11 flex-1 rounded-full bg-green-600 text-[13.5px] font-bold text-white disabled:opacity-50"
                >
                  {assignBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

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
