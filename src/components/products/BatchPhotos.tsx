'use client';

/**
 * Photos for many products at once.
 *
 * Adding a photo product-by-product costs nine steps each — search, open, tap
 * photo, choose a source, pick, confirm, back, search again — and there are
 * ~180 products without one. The work is almost never photography: it is
 * finding a picture in a browser and pasting it. So this is a grid of nothing
 * but a name and a place to put an image, and the loop becomes copy → ⌘V.
 *
 * One tile is ARMED. Pasting anywhere on the page fills it and arms the next
 * one still empty, so a whole category can be done without clicking into
 * anything. Every tile also accepts a dropped file, a picked file and the
 * camera — the same four ways in every photo input in this portal offers, since
 * the products you MAKE have no picture to download.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompany } from '@/lib/company-context';
import { SearchBar, Spinner, EmptyState, leafCategory } from '@/components/inventory/ui';

interface P { id: number; name: string; barcode?: string | false; categ_id?: [number, string] | false }

/** Odoo returns `false` for an unset many2one, so the name is only there sometimes. */
const catName = (p: P): string => (Array.isArray(p.categ_id) ? p.categ_id[1] : '');
type Status = 'idle' | 'saving' | 'saved' | 'error';

async function downscale(file: File | Blob, maxDim = 1024, quality = 0.72): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error('read failed'));
    fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('decode failed')); i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // A format this browser cannot DECODE (some AVIF) still uploads as it came.
    return dataUrl;
  }
}

export default function BatchPhotos({ onBack }: { onBack: () => void }) {
  const { companyId } = useCompany();
  const [products, setProducts] = useState<P[]>([]);
  const [haveImage, setHaveImage] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [missingOnly, setMissingOnly] = useState(true);
  const [armed, setArmed] = useState<number | null>(null);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [ver, setVer] = useState(0);
  const fileFor = useRef<{ id: number; camera: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!companyId) return;
    let stale = false;
    setLoading(true);
    (async () => {
      try {
        const [pr, im] = await Promise.all([
          fetch(`/api/inventory/products?limit=500&include_pos=1&company_id=${companyId}&relevant=1`).then((r) => r.json()),
          fetch('/api/inventory/product-images').then((r) => r.json()).catch(() => ({ with_images: [] })),
        ]);
        if (stale) return;
        setProducts((pr.products || []).filter((p: P & { active?: boolean }) => p.active !== false));
        setHaveImage(new Set<number>(im.with_images || []));
      } finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [companyId]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      const c = leafCategory(catName(p)) || 'Uncategorised';
      m.set(c, (m.get(c) || 0) + (haveImage.has(p.id) ? 0 : 1));
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [products, haveImage]);

  const shown = useMemo(() => {
    let list = products;
    if (cat !== 'all') list = list.filter((p) => (leafCategory(catName(p)) || 'Uncategorised') === cat);
    if (missingOnly) list = list.filter((p) => !haveImage.has(p.id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.barcode || '').includes(q));
    }
    return list;
  }, [products, cat, missingOnly, haveImage, search]);

  /** The next tile still without a photo, so pasting walks the grid by itself. */
  const armNext = useCallback((after: number | null) => {
    const idx = after == null ? -1 : shown.findIndex((p) => p.id === after);
    const next = shown.slice(idx + 1).find((p) => !haveImage.has(p.id))
      ?? shown.find((p) => !haveImage.has(p.id) && p.id !== after);
    setArmed(next ? next.id : null);
  }, [shown, haveImage]);

  useEffect(() => {
    if (armed == null || !shown.some((p) => p.id === armed)) armNext(null);
  }, [shown, armed, armNext]);

  const save = useCallback(async (productId: number, payload: { image?: string; image_url?: string }) => {
    setStatus((s) => ({ ...s, [productId]: 'saving' }));
    setErrors((e) => { const n = { ...e }; delete n[productId]; return n; });
    try {
      const res = await fetch(`/api/inventory/product-images/${productId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus((s) => ({ ...s, [productId]: 'error' }));
        setErrors((e) => ({ ...e, [productId]: d.error || 'Could not save that image.' }));
        return false;
      }
      setHaveImage((prev) => { const n = new Set(prev); n.add(productId); return n; });
      setStatus((s) => ({ ...s, [productId]: 'saved' }));
      setVer((v) => v + 1);
      return true;
    } catch {
      setStatus((s) => ({ ...s, [productId]: 'error' }));
      setErrors((e) => ({ ...e, [productId]: 'Network error — not saved.' }));
      return false;
    }
  }, []);

  const acceptFile = useCallback(async (productId: number, file: File | Blob) => {
    const dataUrl = await downscale(file);
    const ok = await save(productId, { image: dataUrl });
    if (ok) armNext(productId);
  }, [save, armNext]);

  // ⌘V anywhere. Two shapes arrive: a copied IMAGE (a file in the clipboard) and
  // a copied image ADDRESS (text). Which one you get depends on the site, so both
  // are handled rather than making the user find out.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      if (armed == null) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;   // typing in search
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((i) => i.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) { e.preventDefault(); await acceptFile(armed, file); return; }
      }
      const text = e.clipboardData?.getData('text')?.trim();
      if (text && /^https?:\/\//i.test(text)) {
        e.preventDefault();
        const ok = await save(armed, { image_url: text });
        if (ok) armNext(armed);
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [armed, acceptFile, save, armNext]);

  if (!companyId) return <EmptyState icon="🏪" title="Pick a restaurant" body="Choose one in the top bar to add photos." />;
  if (loading) return <Spinner />;

  const done = products.filter((p) => haveImage.has(p.id)).length;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Unfiltered twin of the picker: "Choose a file" must open the real file
          browser, because accept="image/*" gives the same gallery-only sheet as
          the camera roll on the tablets. */}
      <input ref={filesInput} type="file" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; const target = fileFor.current;
          e.target.value = '';
          // Unfiltered by design, so validate here: a general chooser hands
          // back PDFs and zips, and reading + uploading one only for the API
          // to refuse it is a slow way to say no.
          const ok = f && (/^image\//.test(f.type)
            || (!f.type && /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(f.name)));
          if (f && target && ok) await acceptFile(target.id, f);
        }} />
      <input ref={fileInput} type="file" accept="image/*" className="hidden"
        {...(fileFor.current?.camera ? { capture: 'environment' as const } : {})}
        onChange={async (e) => {
          const f = e.target.files?.[0]; const target = fileFor.current;
          e.target.value = '';
          if (f && target) await acceptFile(target.id, f);
        }} />

      <div className="px-4 pt-2 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <span aria-hidden="true">💡</span>
        <span>
          Find a picture in another tab, copy it, come back and press <strong className="text-gray-700">⌘V</strong>.
          It fills the highlighted product and moves to the next. Copying the image <em>or</em> its address both work.
        </span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Find a product…" />

      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Category">
        <button onClick={() => setCat('all')} aria-pressed={cat === 'all'}
          className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border ${
            cat === 'all' ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>
          All {products.filter((p) => !haveImage.has(p.id)).length}
        </button>
        {categories.map(([c, missing]) => (
          <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c}
            className={`flex-shrink-0 px-3 h-8 rounded-full text-[var(--fs-xs)] font-bold border ${
              cat === c ? 'bg-gray-900 border-gray-900 text-white'
                : missing > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-white border-gray-200 text-gray-400'}`}>
            {c} {missing}
          </button>
        ))}
      </div>

      <div className="px-4 pb-2 flex items-center gap-3">
        <button onClick={() => setMissingOnly((v) => !v)} aria-pressed={missingOnly}
          className={`h-9 px-3 rounded-lg border text-[var(--fs-xs)] font-bold ${
            missingOnly ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-500'}`}>
          {missingOnly ? '✓ ' : ''}Only ones without a photo
        </button>
        <span className="text-[var(--fs-xs)] text-gray-500">
          <strong className="text-gray-900">{done}</strong> of {products.length} products have a photo
          {shown.length > 0 && <> · showing {shown.length}</>}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {shown.length === 0 ? (
          <EmptyState icon="✅" title={missingOnly ? 'Every one of these has a photo' : 'Nothing matches'}
            body={missingOnly ? 'Pick another category, or switch off the filter to see them all.' : 'Try a different search.'} />
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {shown.map((p) => {
              const has = haveImage.has(p.id);
              const st = status[p.id] || 'idle';
              const isArmed = armed === p.id;
              return (
                <div key={p.id}
                  onClick={() => setArmed(p.id)}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const f = Array.from(e.dataTransfer?.files || []).find((x) => x.type.startsWith('image/'));
                    if (f) { await acceptFile(p.id, f); return; }
                    // An image dragged straight off a web page arrives as a URL.
                    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text');
                    if (url && /^https?:\/\//i.test(url.trim())) {
                      const ok = await save(p.id, { image_url: url.trim() });
                      if (ok) armNext(p.id);
                    }
                  }}
                  className={`rounded-xl border bg-white overflow-hidden cursor-pointer transition-shadow ${
                    isArmed ? 'border-blue-500 ring-4 ring-blue-100'
                      : st === 'error' ? 'border-red-300'
                      : has ? 'border-green-200' : 'border-gray-200'}`}>
                  <div className={`h-[132px] grid place-items-center relative ${isArmed ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    {has ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/inventory/product-images/${p.id}?v=${ver}`} alt={p.name}
                        className="w-full h-full object-contain" />
                    ) : (
                      <span className={`text-[11px] text-center px-3 leading-snug ${isArmed ? 'text-blue-700 font-bold' : 'text-gray-400'}`}>
                        {isArmed ? 'Paste with ⌘V' : 'Click, paste or drop'}
                      </span>
                    )}
                    {st === 'saving' && (
                      <span className="absolute inset-0 grid place-items-center bg-white/70 text-[11px] font-bold text-gray-600">Saving…</span>
                    )}
                    {st === 'saved' && (
                      <span className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">saved</span>
                    )}
                    {/* Camera + file, for the products you MAKE — nothing to download. */}
                    <span className="absolute bottom-1.5 right-1.5 flex gap-1">
                      <button aria-label={`Take a photo of ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); fileFor.current = { id: p.id, camera: true }; fileInput.current?.setAttribute('capture', 'environment'); fileInput.current?.click(); }}
                        className="w-7 h-7 rounded-lg bg-black/55 text-white text-[12px] grid place-items-center active:bg-black/70">📷</button>
                      <button aria-label={`Choose a photo for ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); fileFor.current = { id: p.id, camera: false }; fileInput.current?.removeAttribute('capture'); fileInput.current?.click(); }}
                        className="w-7 h-7 rounded-lg bg-black/55 text-white text-[12px] grid place-items-center active:bg-black/70">🖼️</button>
                      <button aria-label={`Choose a file for ${p.name}`}
                        onClick={(e) => { e.stopPropagation(); fileFor.current = { id: p.id, camera: false }; filesInput.current?.click(); }}
                        className="w-7 h-7 rounded-lg bg-black/55 text-white text-[12px] grid place-items-center active:bg-black/70">📁</button>
                    </span>
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="text-[12.5px] font-semibold text-gray-900 leading-snug [overflow-wrap:anywhere]">{p.name}</div>
                    {/* The barcode, because six near-identical bottles are told
                        apart by their number and not by their name. */}
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                      {p.barcode ? String(p.barcode) : leafCategory(catName(p)) || '—'}
                    </div>
                    {errors[p.id] && (
                      <div className="text-[11px] text-red-600 font-semibold mt-1 leading-snug">{errors[p.id]}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <button onClick={onBack} className="text-[var(--fs-sm)] font-bold text-gray-500 active:opacity-70">← Back to products</button>
      </div>
    </div>
  );
}
