'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Spinner, ProductThumb } from './ui';
import SpotSheet from './SpotSheet';
import { suggestCrateSizeFromName, baseIsMeasure } from '@/lib/crate-units';
import { useCompany } from '@/lib/company-context';

/**
 * Product page — everything about ONE product in one place:
 * photo (camera/upload), name, unit of measure (Odoo master data), the
 * count-by config (pack word + size + loose word), photo-required rule and
 * the HOME SPOTS. Opened from Product Settings by tapping a product.
 *
 * Name/UoM write to Odoo (the product master); everything else is portal-owned.
 */
const PACK_LABELS = ['piece', 'bunch', 'head', 'crate', 'case', 'box', 'tray', 'bag', 'pack'];

async function downscale(file: File, maxDim = 1024, quality = 0.7): Promise<string> {
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
  } catch { return dataUrl; }
}

export default function ProductDetail({ product, hasImage, onClose, onChanged }: {
  product: { id: number; name: string; uom_id?: [number, string]; categ_id?: [number, string]; barcode?: string | false };
  hasImage: boolean;
  onClose: () => void;
  /** Fired after any successful save so the caller can refresh its list. */
  onChanged: (patch: { name?: string; uom?: [number, string]; imageAdded?: boolean; flags?: { requires_photo?: boolean; units_per_crate?: number | null; pack_label?: string | null; loose_label?: string | null }; spots?: number[] }) => void;
}) {
  const { companyId } = useCompany();
  const [name, setName] = useState(product.name);
  const [uomId, setUomId] = useState<number>(product.uom_id?.[0] || 0);
  const [uoms, setUoms] = useState<{ id: number; name: string }[]>([]);
  const [img, setImg] = useState(hasImage);
  const [imgVer, setImgVer] = useState(0);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [packLabel, setPackLabel] = useState('');
  const [packSize, setPackSize] = useState('');
  const [looseLabel, setLooseLabel] = useState('');
  const [homeSpots, setHomeSpots] = useState<number[]>([]);
  const [spotLabels, setSpotLabels] = useState<Record<number, string>>({});
  const [spotSheet, setSpotSheet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);      // which section is saving
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uomName = uoms.find((u) => u.id === uomId)?.name || product.uom_id?.[1] || 'Units';
  const measure = baseIsMeasure(uomName);

  useEffect(() => {
    (async () => {
      try {
        const [flagRes, uomRes, spotRes, locRes] = await Promise.all([
          fetch(`/api/inventory/product-flags?ids=${product.id}`).then((r) => r.ok ? r.json() : { flags: [] }),
          fetch('/api/inventory/uoms').then((r) => r.ok ? r.json() : { uoms: [] }),
          fetch(`/api/inventory/product-locations?product_id=${product.id}`).then((r) => r.ok ? r.json() : { location_ids: [] }),
          companyId ? fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : { locations: [] }) : { locations: [] },
        ]);
        const f = (flagRes.flags || [])[0];
        if (f) {
          setRequiresPhoto(!!f.requires_photo);
          setPackLabel(f.pack_label || '');
          setPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
          setLooseLabel(f.loose_label || '');
        }
        setUoms(uomRes.uoms || []);
        const locs: any[] = (locRes as any).locations || [];
        const companySpots = new Set(locs.map((l) => l.id));
        setHomeSpots(((spotRes.location_ids || []) as number[]).filter((id) => companySpots.has(id)));
        const byId = new Map<number, any>(locs.map((l) => [l.id, l]));
        const labels: Record<number, string> = {};
        locs.forEach((l) => {
          const parent = l.parent_id != null ? byId.get(l.parent_id) : null;
          labels[l.id] = parent ? `${parent.name} · ${l.name}` : l.name;
        });
        setSpotLabels(labels);
      } catch { /* sections degrade to their defaults */ }
      finally { setLoading(false); }
    })();
  }, [product.id, companyId]);

  function flash(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === 'ok' ? 1800 : 4000);
  }

  async function saveMaster(patch: { name?: string; uom_id?: number }) {
    setBusy('master');
    try {
      const res = await fetch(`/api/inventory/products/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { flash('err', d.error || 'Could not save'); return false; }
      flash('ok', 'Saved');
      onChanged({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.uom_id !== undefined ? { uom: [patch.uom_id, uoms.find((u) => u.id === patch.uom_id)?.name || ''] as [number, string] } : {}),
      });
      return true;
    } catch { flash('err', 'Network error — not saved'); return false; }
    finally { setBusy(null); }
  }

  async function savePack(nextSize: string, nextLabel: string, nextLoose: string) {
    setBusy('pack');
    try {
      const size = nextSize.trim() === '' ? null : Number(nextSize);
      const res = await fetch(`/api/inventory/product-flags/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          units_per_crate: size,
          pack_label: nextLabel || null,
          count_mode: size ? 'pack_loose' : 'simple',
          loose_label: nextLoose.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); flash('err', d.error || 'Could not save'); return; }
      flash('ok', 'Saved');
      onChanged({ flags: { units_per_crate: size, pack_label: nextLabel || null, loose_label: nextLoose.trim() || null } });
    } catch { flash('err', 'Network error — not saved'); }
    finally { setBusy(null); }
  }

  async function togglePhotoRule() {
    const next = !requiresPhoto;
    setRequiresPhoto(next);
    try {
      const res = await fetch(`/api/inventory/product-flags/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_photo: next }),
      });
      if (!res.ok) { setRequiresPhoto(!next); return; }
      onChanged({ flags: { requires_photo: next } });
    } catch { setRequiresPhoto(!next); }
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('photo');
    try {
      const dataUrl = await downscale(file);
      const res = await fetch(`/api/inventory/product-images/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) { flash('err', 'Could not save the photo'); return; }
      setImg(true); setImgVer((v) => v + 1);
      flash('ok', 'Photo saved');
      onChanged({ imageAdded: true });
    } catch { flash('err', 'Network error — photo not saved'); }
    finally { setBusy(null); }
  }

  const suggestion = suggestCrateSizeFromName(name);
  const label = 'block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1';
  const box = 'w-full border-2 border-gray-200 rounded-xl px-3 py-3 bg-gray-50 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-500';

  return (
    <div className="fixed inset-0 z-[100] bg-gray-50 flex flex-col" role="dialog" aria-label={`Product: ${product.name}`}>
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-1 text-gray-500 text-[var(--fs-base)] font-semibold active:opacity-70">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div className="text-[var(--fs-lg)] font-bold text-gray-900">Product</div>
        <div className="w-14 text-right">
          {msg && <span className={`text-[11px] font-bold ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.kind === 'ok' ? '✓' : '!'}</span>}
        </div>
      </div>

      {msg && msg.kind === 'err' && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)] font-semibold">{msg.text}</div>
      )}

      {loading ? <Spinner /> : (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Photo */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhotoFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}
            className="w-full mb-4 rounded-2xl border-2 border-dashed border-gray-300 bg-white overflow-hidden active:opacity-80 disabled:opacity-50"
            aria-label="Change product photo">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/inventory/product-images/${product.id}?v=${imgVer}`} alt="" className="w-full max-h-56 object-cover" />
            ) : (
              <div className="py-10 text-center text-gray-400">
                <div className="text-3xl mb-1">📷</div>
                <div className="text-[var(--fs-sm)] font-semibold">Add a photo — camera or upload</div>
              </div>
            )}
          </button>

          {/* Name */}
          <label className={label} htmlFor="pd-name">Name</label>
          <div className="flex gap-2 mb-4">
            <input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={box} />
            <button onClick={() => name.trim() !== product.name && saveMaster({ name: name.trim() })}
              disabled={busy === 'master' || name.trim() === product.name || name.trim().length < 2}
              className="px-4 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">Save</button>
          </div>

          {/* UoM */}
          <label className={label} htmlFor="pd-uom">Base unit (Odoo)</label>
          <select id="pd-uom" value={uomId}
            onChange={async (e) => {
              const next = Number(e.target.value);
              const prev = uomId;
              setUomId(next);
              if (!(await saveMaster({ uom_id: next }))) setUomId(prev);
            }}
            disabled={busy === 'master'}
            className={`${box} mb-1`}>
            {uoms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <p className="text-[var(--fs-xs)] text-gray-400 mb-4">
            Changing the unit changes what counts mean. Odoo may refuse a change to a different unit family — the reason will show here.
          </p>

          {/* Count-by config */}
          <label className={label}>How staff count it</label>
          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[var(--fs-xs)] font-semibold text-gray-500">Count by</span>
              <select value={packLabel || (measure ? 'piece' : 'crate')}
                onChange={(e) => { setPackLabel(e.target.value); savePack(packSize, e.target.value, looseLabel); }}
                className="h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] font-semibold bg-white">
                {PACK_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="text-[var(--fs-xs)] text-gray-500">1 {packLabel || (measure ? 'piece' : 'crate')} {measure ? '≈' : '='}</span>
              <input value={packSize}
                onChange={(e) => setPackSize(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={(e) => savePack(e.target.value, packLabel || (measure ? 'piece' : 'crate'), looseLabel)}
                inputMode="decimal" placeholder="—"
                className="w-16 h-9 border border-gray-300 rounded-lg text-center font-mono font-semibold" />
              <span className="text-[var(--fs-xs)] text-gray-400">{uomName}</span>
              {suggestion !== null && packSize === '' && (
                <button onClick={() => { setPackSize(String(suggestion)); savePack(String(suggestion), packLabel || 'crate', looseLabel); }}
                  className="text-[11px] font-bold text-blue-800 bg-blue-50 rounded-md px-2 py-1">Suggest: {suggestion}</button>
              )}
            </div>
            {packSize !== '' && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[var(--fs-xs)] text-gray-500">Single-unit word (loose)</span>
                <input value={looseLabel}
                  onChange={(e) => setLooseLabel(e.target.value.slice(0, 20))}
                  onBlur={(e) => savePack(packSize, packLabel || (measure ? 'piece' : 'crate'), e.target.value)}
                  placeholder="bottles"
                  className="w-24 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)]" />
              </div>
            )}
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">Leave the size blank to count in {uomName} only.</p>
          </div>

          {/* Photo rule */}
          <button onClick={togglePhotoRule} className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4">
            <span className="text-[var(--fs-base)] font-semibold text-gray-900">Photo required when counting</span>
            <span className={`relative w-11 h-[26px] rounded-full transition-colors ${requiresPhoto ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
              <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${requiresPhoto ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
            </span>
          </button>

          {/* Home spots */}
          <label className={label}>Where it lives (counted at each)</label>
          <button onClick={() => setSpotSheet(true)} className="w-full flex flex-wrap gap-1.5 bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-left active:bg-gray-50">
            {homeSpots.length > 0 ? homeSpots.map((sid) => (
              <span key={sid} className="text-[11px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-800 border border-blue-200">📍 {spotLabels[sid] || `Spot ${sid}`}</span>
            )) : (
              <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-dashed border-amber-300">📍 No spot yet — tap to set</span>
            )}
          </button>

          {/* Read-only master data */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-8 text-[var(--fs-sm)] text-gray-500">
            <div className="flex justify-between py-1"><span>Category</span><span className="text-gray-800 font-semibold">{product.categ_id?.[1] || '—'}</span></div>
            <div className="flex justify-between py-1"><span>Barcode</span><span className="text-gray-800 font-mono">{product.barcode || '—'}</span></div>
          </div>
        </div>
      )}

      {spotSheet && companyId && (
        <SpotSheet
          product={{ id: product.id, name }}
          hasImage={img}
          companyId={companyId}
          initialSpotIds={homeSpots}
          onSaved={(ids) => { setHomeSpots(ids); onChanged({ spots: ids }); }}
          onClose={() => setSpotSheet(false)}
        />
      )}
    </div>
  );
}
