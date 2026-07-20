'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';
import { suggestCrateSizeFromName, baseIsMeasure } from '@/lib/crate-units';
import { useCompany } from '@/lib/company-context';

// Read a picked image (camera or file), downscale on-device to keep it small,
// return a JPEG data URL. Falls back to the raw data URL if canvas is unavailable.
async function fileToDownscaledDataUrl(file: File, maxDim = 1024, quality = 0.7): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error('read failed'));
    fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode failed'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}

interface ProductSettingsProps {
  onBack: () => void;
}

// Words staff can count a product in. Piece-style first (weight products),
// then pack-style (countable products).
const PACK_LABELS = ['piece', 'bunch', 'head', 'crate', 'case', 'box', 'tray', 'bag', 'pack'];

export default function ProductSettings({ onBack }: ProductSettingsProps) {
  const { companyId } = useCompany();
  const [products, setProducts] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [crateSizes, setCrateSizes] = useState<Record<number, string>>({});   // per-product input strings ('' = none)
  const [packLabels, setPackLabels] = useState<Record<number, string>>({});    // per-product count-by (pack) word
  const [looseLabels, setLooseLabels] = useState<Record<number, string>>({});   // per-product single-unit word (pack+loose mode)
  const [imageIds, setImageIds] = useState<Set<number>>(new Set());             // product ids that have a picture
  const [photoTarget, setPhotoTarget] = useState<number | null>(null);          // which product a pick applies to
  const [imgVer, setImgVer] = useState(0);                                      // cache-bust <img> after an update
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [prodRes, flagRes, imgRes] = await Promise.all([
          fetch(`/api/inventory/products?limit=500&include_pos=1${companyId ? `&company_id=${companyId}&relevant=1` : ''}`).then(r => r.json()),
          fetch('/api/inventory/product-flags').then(r => r.json()),
          fetch('/api/inventory/product-images').then(r => r.json()).catch(() => ({ with_images: [] })),
        ]);
        setImageIds(new Set<number>(imgRes.with_images || []));
        const prods = (prodRes.products || []).filter((p: any) => p.active !== false);
        setProducts(prods);
        const photoMap: Record<number, boolean> = {};
        const crateMap: Record<number, string> = {};
        const labelMap: Record<number, string> = {};
        const looseMap: Record<number, string> = {};
        (flagRes.flags || []).forEach((f: any) => {
          photoMap[f.odoo_product_id] = !!f.requires_photo;
          if (f.units_per_crate != null) crateMap[f.odoo_product_id] = String(f.units_per_crate);
          if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
          if (f.loose_label) looseMap[f.odoo_product_id] = f.loose_label;
        });
        setFlags(photoMap);
        setCrateSizes(crateMap);
        setPackLabels(labelMap);
        setLooseLabels(looseMap);
      } catch (err) {
        console.error('Failed to load product settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId]);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function togglePhoto(productId: number) {
    const next = !flags[productId];
    setFlags(prev => ({ ...prev, [productId]: next }));
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_photo: next }),
      });
      if (!res.ok) setFlags(prev => ({ ...prev, [productId]: !next }));
    } catch {
      setFlags(prev => ({ ...prev, [productId]: !next }));
    }
  }

  // Product picture: one hidden file input (accept image + capture) covers BOTH
  // camera and upload. pickPhoto targets a product, onPhotoFile downscales + saves.
  function pickPhoto(productId: number) {
    setPhotoTarget(productId);
    fileRef.current?.click();
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || photoTarget == null) return;
    const targetId = photoTarget;
    try {
      const dataUrl = await fileToDownscaledDataUrl(file);
      const res = await fetch(`/api/inventory/product-images/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (res.ok) {
        setImageIds(prev => { const n = new Set(prev); n.add(targetId); return n; });
        setImgVer(v => v + 1);
      }
    } catch (err) {
      console.error('Failed to save product photo:', err);
    }
  }

  // Save size + count-by label + loose word together. Empty/0 size clears it
  // (simple mode, count in base units); a size makes it pack+loose.
  async function commitPack(productId: number, rawSize: string, label: string, loose: string) {
    const trimmed = (rawSize || '').trim();
    const size = trimmed === '' ? null : Number(trimmed);
    if (size !== null && (!Number.isFinite(size) || size < 0)) {
      setCrateSizes(prev => ({ ...prev, [productId]: '' }));
      return;
    }
    const mode = size ? 'pack_loose' : 'simple';
    const looseWord = size ? (loose || '').trim() : '';
    setSaving(productId);
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units_per_crate: size, pack_label: label, count_mode: mode, loose_label: looseWord || null }),
      });
      if (res.ok) {
        setSavedId(productId);
        setTimeout(() => setSavedId(prev => (prev === productId ? null : prev)), 1400);
      }
    } catch (err) {
      console.error('Failed to save pack setting:', err);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhotoFile} className="hidden" />
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Product settings</h1>
      </div>

      <div className="px-4 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C2410C" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
        <span>Let staff count a product in a handy unit (piece, bunch, crate…) that converts to its base unit. Leave the size blank to count in base units only.</span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p: any) => {
              const on = !!flags[p.id];
              const uom = p.uom_id?.[1] || 'Units';
              const measure = baseIsMeasure(uom);
              const crateStr = crateSizes[p.id] ?? '';
              const label = packLabels[p.id] ?? (measure ? 'piece' : 'crate');
              const suggestion = suggestCrateSizeFromName(p.name);
              return (
                <div key={p.id} className="py-3.5 border-b border-gray-100 [content-visibility:auto] [contain-intrinsic-size:auto_92px]">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => pickPhoto(p.id)}
                      aria-label={`Photo for ${p.name}`}
                      className="w-11 h-11 rounded-lg bg-gray-100 border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden active:opacity-80"
                    >
                      {imageIds.has(p.id)
                        ? <img src={`/api/inventory/product-images/${p.id}?v=${imgVer}`} alt="" className="w-full h-full object-cover" />
                        : <span className="text-[18px]">📷</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                      <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{p.categ_id?.[1] || ''} · base {uom}</div>
                    </div>
                    <button
                      onClick={() => togglePhoto(p.id)}
                      aria-label="Photo required"
                      className="flex items-center gap-2 flex-shrink-0 active:opacity-80"
                    >
                      <span className="text-[10px] font-bold uppercase text-gray-400">Photo</span>
                      <div className={`relative w-11 h-[26px] rounded-full transition-colors ${on ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
                        <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                    <span className="text-[var(--fs-xs)] font-semibold text-gray-500 mr-1">Count by</span>
                    <select
                      value={label}
                      onChange={(e) => { const v = e.target.value; setPackLabels(prev => ({ ...prev, [p.id]: v })); commitPack(p.id, crateSizes[p.id] ?? '', v, looseLabels[p.id] ?? ''); }}
                      aria-label={`Count-by unit for ${p.name}`}
                      className="h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] font-semibold text-gray-900 bg-white outline-none focus:border-green-500"
                    >
                      {PACK_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <span className="text-[var(--fs-xs)] text-gray-500">1 {label} {measure ? '≈' : '='}</span>
                    <input
                      value={crateStr}
                      onChange={(e) => setCrateSizes(prev => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      onBlur={(e) => commitPack(p.id, e.target.value, label, looseLabels[p.id] ?? '')}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={`Base units per ${label} for ${p.name}`}
                      className="w-14 h-9 border border-gray-300 rounded-lg text-center font-mono text-[var(--fs-base)] font-semibold text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/15"
                    />
                    <span className="text-[var(--fs-xs)] text-gray-400">{uom}</span>
                    {crateStr !== '' && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[var(--fs-xs)] text-gray-500">· also count loose</span>
                        <input
                          value={looseLabels[p.id] ?? ''}
                          onChange={(e) => setLooseLabels(prev => ({ ...prev, [p.id]: e.target.value.slice(0, 20) }))}
                          onBlur={(e) => commitPack(p.id, crateSizes[p.id] ?? '', label, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          placeholder="bottles"
                          aria-label={`Single-unit word for ${p.name}`}
                          className="w-20 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] text-gray-900 outline-none focus:border-green-500"
                        />
                      </span>
                    )}
                    {suggestion !== null && crateStr === '' && (
                      <button
                        onClick={() => { setCrateSizes(prev => ({ ...prev, [p.id]: String(suggestion) })); commitPack(p.id, String(suggestion), label, looseLabels[p.id] ?? ''); }}
                        className="text-[11px] font-bold text-blue-800 bg-blue-50 rounded-md px-2 py-1 active:bg-blue-100"
                      >
                        Suggest: {suggestion}
                      </button>
                    )}
                    {saving === p.id && <span className="text-[11px] text-gray-400">Saving…</span>}
                    {savedId === p.id && saving !== p.id && (
                      <span className="text-[11px] text-green-600 font-semibold inline-flex items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>Saved
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
