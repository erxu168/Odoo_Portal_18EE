'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Spinner, ProductThumb } from './ui';
import SpotSheet from './SpotSheet';
import ManagePackLabels from './ManagePackLabels';
import ManageCategories from './ManageCategories';
import { suggestCrateSizeFromName, baseIsMeasure, pluralizePack, unitWords } from '@/lib/crate-units';
import { CategoryPathButton, CategoryPickerSheet, CategoryForm, type CategoryRow } from './CategoryPicker';
import PackagingLevels from './PackagingLevels';
import { useCompany } from '@/lib/company-context';
import { locationPathLabel } from '@/lib/location-tree';

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

export default function ProductDetail({ product, hasImage, onClose, onChanged, readOnly = false, fullPageHref, baseZ = 100 }: {
  product: { id: number; name: string; uom_id?: [number, string]; categ_id?: [number, string]; barcode?: string | false; active?: boolean };
  hasImage: boolean;
  onClose: () => void;
  /** Fired after any successful save so the caller can refresh its list. */
  onChanged: (patch: { name?: string; uom?: [number, string]; imageAdded?: boolean; flags?: { requires_photo?: boolean; units_per_crate?: number | null; pack_label?: string | null; loose_label?: string | null }; spots?: number[] }) => void;
  /** View-only (no edit capability) — inputs disabled, no writes. */
  readOnly?: boolean;
  /** When shown as an in-flow overlay, the canonical page URL — renders an
   *  "Open full page ↗" link so the user can leave the flow deliberately. */
  fullPageHref?: string;
  /** Base z-index (Tailwind numeric) so this can stack ABOVE another sheet. */
  baseZ?: number;
}) {
  const { companyId } = useCompany();
  const [name, setName] = useState(product.name);
  const [uomId, setUomId] = useState<number>(product.uom_id?.[0] || 0);
  const [uoms, setUoms] = useState<{ id: number; name: string }[]>([]);
  const [catId, setCatId] = useState<number>(product.categ_id?.[0] || 0);
  const [categories, setCategories] = useState<{ id: number; name: string; complete_name?: string }[]>([]);
  const [catBusy, setCatBusy] = useState(false);
  const [manageCats, setManageCats] = useState(false);  // "Edit categories" sheet
  const [catPick, setCatPick] = useState(false);        // the branch picker
  const [isArchived, setIsArchived] = useState(product.active === false);
  const [confirmAction, setConfirmAction] = useState<'archive' | 'unarchive' | 'delete' | null>(null);
  const [lifecycleError, setLifecycleError] = useState<{ message: string; canArchive: boolean } | null>(null);
  const [catForm, setCatForm] = useState<{ editing: CategoryRow | null } | null>(null);
  const loadCategories = () => fetch('/api/inventory/categories')
    .then((r) => (r.ok ? r.json() : { categories: [] }))
    .then((cd) => setCategories(cd.categories || []))
    .catch(() => {});
  const [barcode, setBarcode] = useState<string>(product.barcode || '');
  // Odoo master fields loaded on open (manager-only GET): internal reference,
  // sales price, cost. master0 = the loaded originals, for the dirty-check.
  const [defaultCode, setDefaultCode] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [standardPrice, setStandardPrice] = useState('');
  const [master0, setMaster0] = useState<{ default_code: string; list_price: string; standard_price: string } | null>(null);
  // Suppliers (Odoo product.supplierinfo) + the vendor picker list.
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);
  const [addVendor, setAddVendor] = useState<number>(0);
  const [addPrice, setAddPrice] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');   // 149 suppliers — a wheel picker alone is unusable on a phone
  const shownVendors = React.useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    return q ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
  }, [vendors, vendorSearch]);
  const [supBusy, setSupBusy] = useState(false);
  const [img, setImg] = useState(hasImage);
  const [imgVer, setImgVer] = useState(0);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [packLabel, setPackLabel] = useState('');
  const [packSize, setPackSize] = useState('');
  const [looseLabel, setLooseLabel] = useState('');
  const [homeSpots, setHomeSpots] = useState<number[]>([]);
  const [spotLabels, setSpotLabels] = useState<Record<number, string>>({});
  const [spotSheet, setSpotSheet] = useState(false);
  // Editable "Count by" units (seeded from the defaults) + the manage sheet.
  const [packUnits, setPackUnits] = useState<string[]>(PACK_LABELS);
  const [manageUnits, setManageUnits] = useState(false);
  const loadUnits = () => fetch('/api/inventory/pack-labels')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.labels) setPackUnits(d.labels.map((x: any) => x.label)); })
    .catch(() => {});
  // Re-pull THIS product's flags — after a unit rename/delete cascades in the DB,
  // the in-memory pack_label would otherwise be stale and a later pack-size save
  // could write the old (now-gone) label back, orphaning the product.
  const loadFlags = () => fetch(`/api/inventory/product-flags?ids=${product.id}`)
    .then((r) => (r.ok ? r.json() : { flags: [] }))
    .then((d) => {
      const f = (d.flags || [])[0];
      if (f) {
        setRequiresPhoto(!!f.requires_photo);
        setPackLabel(f.pack_label || '');
        setPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
        setLooseLabel(f.loose_label || '');
      }
    })
    .catch(() => {});
  useEffect(() => { loadUnits(); }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);      // which section is saving
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uomName = uoms.find((u) => u.id === uomId)?.name || product.uom_id?.[1] || 'Units';
  const measure = baseIsMeasure(uomName);
  // The word actually in force — the saved one, or the implicit default. The
  // Suggest button used to hard-code 'crate' here and would quietly overwrite a
  // kg product's 'piece' with 'crate' the moment someone accepted a suggestion.
  const effPack = unitWords(uomName, packLabel, looseLabel).pack;

  useEffect(() => {
    (async () => {
      try {
        const [flagRes, uomRes, spotRes, locRes, masterRes] = await Promise.all([
          fetch(`/api/inventory/product-flags?ids=${product.id}`).then((r) => r.ok ? r.json() : { flags: [] }),
          fetch('/api/inventory/uoms').then((r) => r.ok ? r.json() : { uoms: [] }),
          fetch(`/api/inventory/product-locations?product_id=${product.id}`).then((r) => r.ok ? r.json() : { location_ids: [] }),
          companyId ? fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : { locations: [] }) : { locations: [] },
          // Odoo master (manager-only) — internal ref, sales price, cost. 403 for
          // non-managers is fine; the section is hidden for them anyway.
          fetch(`/api/inventory/products/${product.id}`).then((r) => r.ok ? r.json() : { product: null }).catch(() => ({ product: null })),
        ]);
        const m = (masterRes as any).product;
        if (m) {
          const dc = m.default_code || '';
          const lp = m.list_price != null ? String(m.list_price) : '';
          const sp = m.standard_price != null ? String(m.standard_price) : '';
          setDefaultCode(dc); setListPrice(lp); setStandardPrice(sp);
          setMaster0({ default_code: dc, list_price: lp, standard_price: sp });
          // Suppliers + vendor picker (manager-only, same gate as the master GET).
          Promise.all([
            fetch(`/api/inventory/products/${product.id}/suppliers`).then((r) => r.ok ? r.json() : { suppliers: [] }).catch(() => ({ suppliers: [] })),
            fetch('/api/inventory/vendors').then((r) => r.ok ? r.json() : { vendors: [] }).catch(() => ({ vendors: [] })),
          ]).then(([supRes, vendRes]) => { setSuppliers(supRes.suppliers || []); setVendors(vendRes.vendors || []); }).catch(() => {});
        }
        const f = (flagRes.flags || [])[0];
        if (f) {
          setRequiresPhoto(!!f.requires_photo);
          setPackLabel(f.pack_label || '');
          setPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
          setLooseLabel(f.loose_label || '');
        }
        setUoms(uomRes.uoms || []);
        loadCategories();
        const locs: any[] = (locRes as any).locations || [];
        const companySpots = new Set(locs.map((l) => l.id));
        setHomeSpots(((spotRes.location_ids || []) as number[]).filter((id) => companySpots.has(id)));
        // Full path so a deep spot chip reads "Basement › Freezer › Shelf 3".
        const labels: Record<number, string> = {};
        locs.forEach((l) => { labels[l.id] = locationPathLabel(l.id, locs); });
        setSpotLabels(labels);
      } catch { /* sections degrade to their defaults */ }
      finally { setLoading(false); }
    })();
  }, [product.id, companyId]);

  function flash(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === 'ok' ? 1800 : 4000);
  }

  async function saveMaster(patch: { name?: string; uom_id?: number; categ_id?: number; barcode?: string; default_code?: string; list_price?: number; standard_price?: number }) {
    if (readOnly) return false;
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

  // Selling & cost (internal ref, sales price, cost) — one PUT for whatever changed.
  const sellingCostDirty = !!master0 && (defaultCode !== master0.default_code || listPrice !== master0.list_price || standardPrice !== master0.standard_price);
  async function saveSellingCost() {
    if (!master0 || readOnly) return;
    const patch: { default_code?: string; list_price?: number; standard_price?: number } = {};
    if (defaultCode !== master0.default_code) patch.default_code = defaultCode.trim();
    if (listPrice !== master0.list_price) patch.list_price = Number(listPrice || 0);
    if (standardPrice !== master0.standard_price) patch.standard_price = Number(standardPrice || 0);
    if (Object.keys(patch).length === 0) return;
    if (await saveMaster(patch)) setMaster0({ default_code: defaultCode, list_price: listPrice, standard_price: standardPrice });
  }

  async function reloadSuppliers() {
    const r = await fetch(`/api/inventory/products/${product.id}/suppliers`).then((x) => x.ok ? x.json() : { suppliers: [] }).catch(() => ({ suppliers: [] }));
    setSuppliers(r.suppliers || []);
  }
  async function addSupplier() {
    if (!addVendor || supBusy || readOnly) return;
    setSupBusy(true);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/suppliers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_id: addVendor, price: addPrice === '' ? 0 : Number(addPrice) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { flash('err', d.error || 'Could not add the supplier'); return; }
      await reloadSuppliers();
      setAddVendor(0); setAddPrice('');
      flash('ok', 'Supplier added');
    } catch { flash('err', 'Network error — not added'); }
    finally { setSupBusy(false); }
  }
  async function removeSupplier(supId: number) {
    if (supBusy || readOnly) return;
    setSupBusy(true);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/suppliers?supplierinfo_id=${supId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { flash('err', d.error || 'Could not remove the supplier'); return; }
      await reloadSuppliers();
    } catch { flash('err', 'Network error — not removed'); }
    finally { setSupBusy(false); }
  }

  // Quick-create a category in Odoo without leaving the form, then select +
  // assign it (in-place create rule — no dead-end picker).
  /**
   * Create a category, or save an edited one. Moving IS editing — the parent is
   * just another field — so one function does both and they cannot drift.
   */
  /**
   * Archive, bring back, or delete. Odoo's refusal to delete is the useful
   * answer, not an error to swallow — it names what still uses the product —
   * so it is shown as written, with archiving offered as the way forward.
   */
  async function runLifecycle(action: 'archive' | 'unarchive' | 'delete') {
    setBusy('lifecycle');
    setLifecycleError(null);
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/inventory/products/${product.id}`, { method: 'DELETE' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLifecycleError({
            message: d.error || 'Could not delete this product.',
            canArchive: res.status === 409,
          });
          return;
        }
        setConfirmAction(null);
        flash('ok', 'Product deleted');
        onChanged({});
        onClose();
        return;
      }
      const active = action === 'unarchive';
      const res = await fetch(`/api/inventory/products/${product.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setLifecycleError({ message: d.error || 'Could not save.', canArchive: false }); return; }
      setIsArchived(!active);
      setConfirmAction(null);
      flash('ok', active ? 'Product is back' : 'Product archived');
      onChanged({});
    } catch {
      setLifecycleError({ message: 'Network error — nothing was changed.', canArchive: false });
    } finally {
      setBusy(null);
    }
  }

  async function saveCategory(editing: CategoryRow | null, nm: string, parentId: number | null) {
    if (!nm) return;
    setCatBusy(true);
    try {
      const res = await fetch('/api/inventory/categories', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, name: nm, parent_id: parentId }
                                     : { name: nm, parent_id: parentId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.category?.id) { flash('err', d.error || 'Could not save the category'); return; }
      await loadCategories();
      setCatForm(null);
      if (!editing) {
        // A category made here is the one you wanted for this product.
        const prev = catId;
        setCatId(d.category.id);
        if (!(await saveMaster({ categ_id: d.category.id }))) setCatId(prev);
      }
      flash('ok', editing ? 'Category saved' : 'Category created');
    } catch {
      flash('err', 'Network error \u2014 the category was not saved.');
    } finally {
      setCatBusy(false);
    }
  }

  async function savePack(nextSize: string, nextLabel: string, nextLoose: string) {
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (readOnly) return;
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
    <div className="fixed inset-0 bg-gray-50 flex flex-col" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label={`Product: ${product.name}`}>
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-1 text-gray-500 text-[var(--fs-base)] font-semibold active:opacity-70">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div className="text-[var(--fs-lg)] font-bold text-gray-900">Product{readOnly && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 align-middle">view only</span>}</div>
        <div className="min-w-[56px] text-right">
          {/* Drill-out: from an in-flow overlay, jump to the record's own page. */}
          {fullPageHref ? (
            <a href={fullPageHref} className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 active:opacity-70" aria-label="Open the full product page">
              Full page
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
            </a>
          ) : (
            msg && <span className={`text-[11px] font-bold ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.kind === 'ok' ? '✓' : '!'}</span>
          )}
        </div>
      </div>

      {msg && msg.kind === 'err' && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)] font-semibold">{msg.text}</div>
      )}

      {loading ? <Spinner /> : (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Photo */}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPhotoFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={busy === 'photo' || readOnly}
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
            <input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={readOnly} className={box} />
            <button onClick={() => name.trim() !== product.name && saveMaster({ name: name.trim() })}
              disabled={readOnly || busy === 'master' || name.trim() === product.name || name.trim().length < 2}
              className="px-4 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">Save</button>
          </div>

          {/* Selling & cost (Odoo master) — loaded + shown for managers only. */}
          {master0 && !readOnly && (
            <div className="mb-4">
              <label className={label}>Selling & cost</label>
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                <div>
                  <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Internal reference</div>
                  <input value={defaultCode} onChange={(e) => setDefaultCode(e.target.value)} maxLength={64}
                    placeholder="e.g. BBQ-HOT-40" className={box} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Sales price</div>
                    <input value={listPrice} onChange={(e) => setListPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal" placeholder="0.00" className={box} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Cost</div>
                    <input value={standardPrice} onChange={(e) => setStandardPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal" placeholder="0.00" className={box} />
                  </div>
                </div>
                <button onClick={saveSellingCost} disabled={busy === 'master' || !sellingCostDirty}
                  className="w-full py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">
                  {busy === 'master' ? 'Saving…' : 'Save selling & cost'}
                </button>
                <p className="text-[var(--fs-xs)] text-gray-400">Writes to Odoo — affects sales & margins.</p>
              </div>
            </div>
          )}

          {/* Suppliers (Odoo product.supplierinfo) — manager only. */}
          {master0 && !readOnly && (
            <div className="mb-4">
              <label className={label}>Suppliers</label>
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                {suppliers.length === 0 ? (
                  <p className="text-[var(--fs-xs)] text-gray-400">No supplier yet — add one below.</p>
                ) : suppliers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">{Array.isArray(s.partner_id) ? s.partner_id[1] : 'Vendor'}</div>
                      <div className="text-[var(--fs-xs)] text-gray-400">Price {s.price ?? 0}{s.min_qty ? ` · min ${s.min_qty}` : ''}</div>
                    </div>
                    <button onClick={() => removeSupplier(s.id)} disabled={supBusy} aria-label="Remove supplier"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                <div className="pt-2 border-t border-gray-100">
                  <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)}
                    placeholder="Search suppliers…" aria-label="Search suppliers"
                    className="w-full h-9 border border-gray-300 rounded-lg px-2.5 text-[var(--fs-sm)] mb-2" />
                </div>
                <div className="flex gap-2">
                  <select value={addVendor} onChange={(e) => setAddVendor(Number(e.target.value))}
                    className="flex-1 min-w-0 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] bg-white">
                    <option value={0}>
                      {(() => { const n = shownVendors.length; return vendorSearch ? `${n} match${n === 1 ? '' : 'es'}\u2026` : 'Choose a supplier\u2026'; })()}
                    </option>
                    {shownVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input value={addPrice} onChange={(e) => setAddPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal" placeholder="Price"
                    className="w-20 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] text-center" />
                  <button onClick={addSupplier} disabled={!addVendor || supBusy}
                    className="px-3 h-9 rounded-lg bg-green-600 text-white font-bold text-[var(--fs-sm)] disabled:opacity-40">Add</button>
                </div>
                {vendors.length === 0 && <p className="text-[var(--fs-xs)] text-gray-400">No vendors in Odoo yet — add them in Purchase.</p>}
              </div>
            </div>
          )}

          {/* UoM */}
          <label className={label} htmlFor="pd-uom">Base unit (Odoo)</label>
          <select id="pd-uom" value={uomId}
            onChange={async (e) => {
              const next = Number(e.target.value);
              const prev = uomId;
              setUomId(next);
              if (!(await saveMaster({ uom_id: next }))) setUomId(prev);
            }}
            disabled={busy === 'master' || readOnly}
            className={`${box} mb-1`}>
            {uoms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <p className="text-[var(--fs-xs)] text-gray-400 mb-4">
            Changing the unit changes what counts mean. Odoo may refuse a change to a different unit family — the reason will show here.
          </p>

          {/* Count-by config */}
          <label className={label}>How staff count it</label>
          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
            {/* Written as the sentence a person would say — "1 crate = 24
                bottles" — because these two words are what staff read on every
                count screen. The old version asked for a "single-unit word
                (loose)" in a box of its own, and nobody knew what that meant. */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[var(--fs-sm)] font-semibold text-gray-500">1</span>
              <select value={effPack} disabled={readOnly}
                onChange={(e) => { setPackLabel(e.target.value); savePack(packSize, e.target.value, looseLabel); }}
                className="h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] font-semibold bg-white disabled:opacity-60">
                {/* Keep the EFFECTIVE current unit selectable even if it was removed from the
                    list — covers the implicit default (piece/crate) when pack_label is null. */}
                {Array.from(new Set([effPack, ...packUnits])).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="text-[var(--fs-sm)] font-semibold text-gray-500">{measure ? '\u2248' : '='}</span>
              <input value={packSize} disabled={readOnly}
                onChange={(e) => setPackSize(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={(e) => savePack(e.target.value, effPack, looseLabel)}
                inputMode="decimal" placeholder="—"
                aria-label={`How many ${uomName} in one ${effPack}`}
                className="w-16 h-9 border border-gray-300 rounded-lg text-center font-mono font-semibold" />
              {measure ? (
                <span className="text-[var(--fs-sm)] text-gray-400">{uomName}</span>
              ) : (
                <input value={looseLabel} disabled={readOnly}
                  onChange={(e) => setLooseLabel(e.target.value.slice(0, 20))}
                  onBlur={(e) => savePack(packSize, effPack, e.target.value)}
                  placeholder={uomName}
                  aria-label="What one of them is called"
                  className="w-28 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] font-semibold" />
              )}
              {!readOnly && (
                <button onClick={() => setManageUnits(true)} className="text-[11px] font-bold text-blue-700 active:opacity-70" aria-label="Edit the count-by units">Edit units</button>
              )}
              {suggestion !== null && packSize === '' && (
                <button onClick={() => { setPackSize(String(suggestion)); savePack(String(suggestion), effPack, looseLabel); }}
                  disabled={readOnly}
                  className="text-[11px] font-bold text-blue-800 bg-blue-50 rounded-md px-2 py-1 disabled:opacity-40">Suggest: {suggestion}</button>
              )}
            </div>
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">
              {packSize === '' ? (
                <>
                  Fill in how many {unitWords(uomName, effPack, looseLabel).looseFor(2)} are in one {effPack}
                  {' '}and staff can count whole {pluralizePack(effPack, 2)} plus loose ones.
                  Leave it blank and they count in {unitWords(uomName, effPack, looseLabel).looseFor(2)} only.
                </>
              ) : measure ? (
                `Staff count whole ${pluralizePack(effPack, 2)}; Odoo gets ${uomName}.`
              ) : (
                `Staff count whole ${pluralizePack(effPack, 2)} AND loose ${unitWords(uomName, effPack, looseLabel).looseFor(2)}. Odoo still gets ${uomName}.`
              )}
            </p>
          </div>

          {/* Mounted now that counting reads the chain: a count freezes it at
              creation, the sheet offers a stepper per level, and the server does
              the conversion from the frozen copy. Filling this in changes what
              staff see — which was the condition for showing it at all. */}
          <PackagingLevels
            productId={product.id}
            baseWord={unitWords(uomName, effPack, looseLabel).looseFor(2)}
            readOnly={readOnly}
          />

          {/* Photo rule */}
          <button onClick={togglePhotoRule} disabled={readOnly} className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 disabled:opacity-70">
            <span className="text-[var(--fs-base)] font-semibold text-gray-900">Photo required when counting</span>
            <span className={`relative inline-block w-11 h-[26px] rounded-full flex-shrink-0 transition-colors ${requiresPhoto ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
              <span className={`absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${requiresPhoto ? 'translate-x-[18px]' : 'translate-x-0'}`} />
            </span>
          </button>

          {/* Home spots */}
          <label className={label}>Where it lives (counted at each)</label>
          <button onClick={() => !readOnly && setSpotSheet(true)} disabled={readOnly} className="w-full flex flex-wrap gap-1.5 bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-left active:bg-gray-50 disabled:opacity-70">
            {homeSpots.length > 0 ? homeSpots.map((sid) => (
              <span key={sid} className="text-[11px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-800 border border-blue-200 max-w-full [overflow-wrap:anywhere]">📍 {spotLabels[sid] || `Spot ${sid}`}</span>
            )) : (
              <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-dashed border-amber-300">📍 No spot yet — tap to set</span>
            )}
          </button>

          {/* Category — editable (Odoo product.category), with in-place create + manage */}
          <div className="flex items-center justify-between mb-1">
            <label className={`${label} mb-0`} htmlFor="pd-cat">Category</label>
            {!readOnly && <button type="button" onClick={() => setManageCats(true)} className="text-[11px] font-bold text-blue-700 active:opacity-70">Edit categories</button>}
          </div>
          {/* A branch, walked — not 46 leaf names printed flush left. */}
          <div className="mb-2">
            <CategoryPathButton cats={categories} value={catId || null} disabled={readOnly || busy === 'master' || catBusy}
              placeholder="Choose a category" onOpen={() => setCatPick(true)} />
          </div>
          {!readOnly && (
            <button onClick={() => setCatForm({ editing: null })} disabled={catBusy}
              className="text-[11px] font-bold text-green-700 active:opacity-70 mb-4 disabled:opacity-40">
              ＋ New category
            </button>
          )}
          {catPick && (
            <CategoryPickerSheet
              cats={categories}
              value={catId || null}
              onPick={async (next) => {
                setCatPick(false);
                if (next === catId) return;
                const prev = catId; setCatId(next);
                if (!(await saveMaster({ categ_id: next }))) setCatId(prev);
              }}
              onClose={() => setCatPick(false)}
            />
          )}
          {catForm && (
            <CategoryForm
              cats={categories}
              editing={catForm.editing}
              initialParent={catForm.editing ? undefined : (catId || null)}
              busy={catBusy}
              onCancel={() => setCatForm(null)}
              onSave={async (nm, parentId) => { await saveCategory(catForm.editing, nm, parentId); }}
            />
          )}

          {/* Barcode — editable */}
          <label className={label} htmlFor="pd-barcode">Barcode</label>
          <div className="flex gap-2 mb-8">
            <input id="pd-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={readOnly}
              placeholder="Scan or type…" className={`${box} font-mono`} />
            <button onClick={() => (barcode.trim() !== (product.barcode || '')) && saveMaster({ barcode: barcode.trim() })}
              disabled={readOnly || busy === 'master' || barcode.trim() === (product.barcode || '')}
              className="px-4 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">Save</button>
          </div>

          {/* Taking a product out of use. Archive reads as the ordinary action
              because it is the one that almost always applies; delete sits
              under it and looks like what it is. */}
          {!readOnly && (
            <>
              <label className={label}>Take it out of use</label>
              {isArchived ? (
                <button onClick={() => setConfirmAction('unarchive')} disabled={!!busy}
                  className="w-full mb-2 flex items-center gap-3 px-3 py-3 rounded-xl border border-green-200 bg-green-50 text-left active:bg-green-100 disabled:opacity-50">
                  <span aria-hidden="true">↩️</span>
                  <span>
                    <span className="block text-[var(--fs-base)] font-bold text-green-800">Bring this product back</span>
                    <span className="block text-[var(--fs-xs)] text-green-700">It is archived — hidden from lists, counts and the POS.</span>
                  </span>
                </button>
              ) : (
                <button onClick={() => setConfirmAction('archive')} disabled={!!busy}
                  className="w-full mb-2 flex items-center gap-3 px-3 py-3 rounded-xl border border-amber-300 bg-amber-50 text-left active:bg-amber-100 disabled:opacity-50">
                  <span aria-hidden="true">📥</span>
                  <span>
                    <span className="block text-[var(--fs-base)] font-bold text-amber-800">Archive this product</span>
                    <span className="block text-[var(--fs-xs)] text-amber-700">Hidden everywhere. Counts and orders keep it. Undo any time.</span>
                  </span>
                </button>
              )}
              <button onClick={() => setConfirmAction('delete')} disabled={!!busy}
                className="w-full mb-8 flex items-center gap-3 px-3 py-3 rounded-xl border border-red-200 text-left active:bg-red-50 disabled:opacity-50">
                <span aria-hidden="true">🗑️</span>
                <span>
                  <span className="block text-[var(--fs-base)] font-bold text-red-600">Delete for good</span>
                  <span className="block text-[var(--fs-xs)] text-red-500">Only possible while nothing has ever used it.</span>
                </span>
              </button>
            </>
          )}
        </div>
      )}

      {confirmAction && (
        <ProductLifecycleSheet
          action={confirmAction}
          productName={name}
          busy={busy === 'lifecycle'}
          error={lifecycleError}
          onArchiveInstead={() => { setLifecycleError(null); setConfirmAction('archive'); }}
          onCancel={() => { setConfirmAction(null); setLifecycleError(null); }}
          onConfirm={() => runLifecycle(confirmAction)}
        />
      )}

      {spotSheet && companyId && (
        <SpotSheet
          product={{ id: product.id, name }}
          hasImage={img}
          companyId={companyId}
          baseZ={baseZ + 10}
          initialSpotIds={homeSpots}
          onSaved={(ids) => { setHomeSpots(ids); onChanged({ spots: ids }); }}
          onClose={() => setSpotSheet(false)}
        />
      )}

      {manageUnits && (
        <ManagePackLabels baseZ={baseZ + 10} onChanged={() => { loadUnits(); loadFlags(); }} onClose={() => setManageUnits(false)} />
      )}
      {manageCats && (
        <ManageCategories baseZ={baseZ + 10} onChanged={loadCategories} onClose={() => setManageCats(false)} />
      )}
    </div>
  );
}

/**
 * Confirming a product's fate. One sheet for all three because they answer the
 * same question — what happens to this product and what happens to its history
 * — and three near-identical sheets would drift.
 */
function ProductLifecycleSheet({
  action, productName, busy, error, onConfirm, onCancel, onArchiveInstead,
}: {
  action: 'archive' | 'unarchive' | 'delete';
  productName: string;
  busy: boolean;
  error: { message: string; canArchive: boolean } | null;
  onConfirm: () => void;
  onCancel: () => void;
  onArchiveInstead: () => void;
}) {
  const copy = {
    archive: {
      title: 'Archive this product?',
      lead: 'It stops appearing in counting lists, order guides, the POS and search — for everyone.',
      keep: 'Counts it already appears in keep it, approved history and all. You can bring it back any time.',
      cta: 'Archive it',
      tone: 'amber' as const,
    },
    unarchive: {
      title: 'Bring this product back?',
      lead: 'It starts appearing again in lists, counts, order guides and search.',
      keep: 'Nothing else changes — its settings, photos and history were kept while it was away.',
      cta: 'Bring it back',
      tone: 'green' as const,
    },
    delete: {
      title: 'Delete for good?',
      lead: 'This removes the product from Odoo entirely. There is no undo.',
      keep: 'It only works while nothing has ever used it — no stock moves, no sales, no approved count. Otherwise archiving is the way.',
      cta: 'Delete it',
      tone: 'red' as const,
    },
  }[action];

  const btn = copy.tone === 'red' ? 'bg-red-600' : copy.tone === 'amber' ? 'bg-amber-600' : 'bg-green-600';

  return (
    <div className="fixed inset-0 z-[140] flex items-end" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onCancel} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full bg-white rounded-t-3xl max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900">{copy.title}</div>
          <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 [overflow-wrap:anywhere]">{productName}</div>
        </div>

        <div className="px-5 py-4">
          <p className="text-[var(--fs-sm)] text-gray-800">{copy.lead}</p>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-2">{copy.keep}</p>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <p className="text-[var(--fs-sm)] font-semibold text-red-700 [overflow-wrap:anywhere]">{error.message}</p>
              {error.canArchive && (
                <button onClick={onArchiveInstead}
                  className="mt-2.5 w-full h-11 rounded-xl bg-amber-600 text-white font-bold active:bg-amber-700">
                  Archive it instead
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-5">
          <button onClick={onConfirm} disabled={busy}
            className={`w-full h-12 rounded-xl ${btn} text-white font-bold disabled:opacity-40`}>
            {busy ? 'Working…' : copy.cta}
          </button>
          <button onClick={onCancel} disabled={busy}
            className="w-full h-11 mt-2 rounded-xl border border-gray-200 text-gray-600 font-bold disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
