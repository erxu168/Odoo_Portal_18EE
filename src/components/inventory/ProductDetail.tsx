'use client';

import React, { useState, useEffect, useRef } from 'react';
import NumberField from '@/components/ui/NumberField';
import { Spinner, ProductThumb } from './ui';
import SpotSheet from './SpotSheet';
import ManagePackLabels from './ManagePackLabels';
import ManageCategories from './ManageCategories';
import { suggestCrateSizeFromName, baseIsMeasure, pluralizePack, unitWords, parEntryFactor, parToEntry, parToBase, round2 } from '@/lib/crate-units';
import { CategoryPathButton, CategoryPickerSheet, CategoryForm, type CategoryRow } from './CategoryPicker';
import PackagingLevels from './PackagingLevels';
import DropZone from '@/components/ui/DropZone';
import { ContainerLevelGlyph, type ContainerShape } from '@/components/ui/ContainerLevelPicker';
import PhotoLightbox from './PhotoLightbox';
import { useCompany } from '@/lib/company-context';
import { locationPathLabel } from '@/lib/location-tree';
import { plainFromOdooHtml } from '@/lib/odoo-html';
import { currentCompanyTax, hasConflictingTax, type TaxOption } from '@/lib/product-tax';
import PhotoSourceSheet from '@/components/ui/PhotoSourceSheet';

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

export default function ProductDetail({ product, hasImage, onClose, onChanged, readOnly = false, fullPageHref, baseZ = 100, justCreated = false }: {
  product: { id: number; name: string; uom_id?: [number, string]; categ_id?: [number, string]; barcode?: string | false; active?: boolean; is_draft?: boolean };
  hasImage: boolean;
  onClose: () => void;
  /** Fired after any successful save so the caller can refresh its list. */
  onChanged: (patch: {
    name?: string;
    uom?: [number, string];
    /** true after a photo is saved, false after one is removed. */
    imageAdded?: boolean;
    flags?: { requires_photo?: boolean; units_per_crate?: number | null; pack_label?: string | null; loose_label?: string | null; level_shape?: string | null };
    spots?: number[];
    /**
     * The product was archived (false) or brought back (true). A list that hides
     * archived products has to be TOLD — it cannot infer it from an empty patch,
     * which is what this used to send, so every list sat stale until a reload.
     */
    active?: boolean;
    /** The product is gone from Odoo. Drop it, do not try to re-read it. */
    deleted?: true;
    /** A scanned draft was put in use, so it is a draft no longer. */
    is_draft?: false;
    /**
     * Odoo's stock tracking was turned on or off. The catalog shows a
     * "Not counted in stock" badge and a filter counting these, so it has to be
     * TOLD — exactly like `active` above, which sat stale for the same reason
     * until it was added.
     */
    is_storable?: boolean;
  }) => void;
  /** View-only (no edit capability) — inputs disabled, no writes. */
  readOnly?: boolean;
  /** When shown as an in-flow overlay, the canonical page URL — renders an
   *  "Open full page ↗" link so the user can leave the flow deliberately. */
  fullPageHref?: string;
  /** Base z-index (Tailwind numeric) so this can stack ABOVE another sheet. */
  baseZ?: number;
  /**
   * Arrived here straight from "Add a product". The intake sheet asks only what
   * cannot be guessed, so a brand-new product is deliberately incomplete — this
   * says WHICH parts, in the order they matter, instead of presenting a page of
   * empty fields and leaving the manager to work out what counts.
   */
  justCreated?: boolean;
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
  // A scan-to-create DRAFT is also active === false and is not archived — it is
  // waiting for review. Telling its opener "it is archived" and offering "Bring
  // this product back" would activate it outside that review flow.
  const [isArchived, setIsArchived] = useState(product.active === false && !product.is_draft);
  // Held in state so putting a draft in use flips the screen immediately, but
  // RE-SEEDED from the prop below — an overlay reused for a different product,
  // or a parent that re-fetched, would otherwise keep the previous product's
  // draft mode and offer "Put it in use" for something already in use.
  const [isDraft, setIsDraft] = useState(product.is_draft === true);
  useEffect(() => { setIsDraft(product.is_draft === true); }, [product.id, product.is_draft]);
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
  const [note, setNote] = useState('');
  const [note0, setNote0] = useState('');
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
  const [viewer, setViewer] = useState(false);      // full-screen photo
  const [photoMenu, setPhotoMenu] = useState(false); // replace / remove
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [packLabel, setPackLabel] = useState('');
  const [packSize, setPackSize] = useState('');
  // The pack size the SERVER has — parFactor below reads this, not packSize,
  // so a half-typed "0.2" on its way to "0.28" never rescales the par fields.
  const [savedPackSize, setSavedPackSize] = useState('');
  const [looseLabel, setLooseLabel] = useState('');
  const [levelShape, setLevelShape] = useState<string>('');   // '' = off
  // Why the stock switch refused — shown INLINE under the toggle, persistently.
  // The transient top-of-sheet flash scrolls out of view exactly when someone
  // is down at the Stock section flipping this.
  const [storableError, setStorableError] = useState<string | null>(null);
  const [photoChooser, setPhotoChooser] = useState(false);   // Camera·Photos·Files
  const productIdRef = useRef(product.id);
  productIdRef.current = product.id;
  useEffect(() => { setStorableError(null); }, [product.id]);   // never carry a refusal to another product
  // The saved packaging chain, reported up by <PackagingLevels> when it loads
  // or saves — read here only to translate a typed par into boxes.
  const [packChain, setPackChain] = useState<{ name: string; to_base: number }[]>([]);
  const onChainLevels = React.useCallback(
    (levels: { name: string; to_base: number }[]) => setPackChain(levels), []);
  // PAR — how much this restaurant wants to hold. Stored per company, unlike
  // pack size above, which is shared: WAJ and Ssam keep different volumes of the
  // same product.
  const [parMin, setParMin] = useState('');
  const [parMax, setParMax] = useState('');
  const [parErr, setParErr] = useState('');
  const [homeSpots, setHomeSpots] = useState<number[]>([]);
  const [spotLabels, setSpotLabels] = useState<Record<number, string>>({});
  const [spotSheet, setSpotSheet] = useState(false);
  // TRACK INVENTORY (Odoo 18 `is_storable`). Separate from "is it a physical
  // good?", and it defaults to OFF — which is why 133 products in this catalog
  // hold no stock figure and could never have taken a count.
  const [storable, setStorable] = useState<boolean | null>(null);
  // TAX — per restaurant, on a record most restaurants share. Two fields
  // because Odoo keeps two and they are not the same money: what a supplier
  // charges you, and what you charge a customer.
  const [taxOpts, setTaxOpts] = useState<{ sale: TaxOption[]; purchase: TaxOption[] }>({ sale: [], purchase: [] });
  const [saleTax, setSaleTax] = useState<number | null>(null);
  const [purchaseTax, setPurchaseTax] = useState<number | null>(null);
  // Tracked per tax type: saving the sales tax must not silently clear a warning
  // that the PURCHASE tax is still doubled up.
  const [taxClash, setTaxClash] = useState<{ sale: boolean; purchase: boolean }>({ sale: false, purchase: false });
  // Per type, for the same reason taxClash is: saving the selling tax must not
  // clear a warning about the BUYING tax.
  const [taxRetired, setTaxRetired] = useState<{ sale: boolean; purchase: boolean }>({ sale: false, purchase: false });
  // Editable "Count by" units (seeded from the defaults) + the manage sheet.
  const [packUnits, setPackUnits] = useState<string[]>(PACK_LABELS);
  const [manageUnits, setManageUnits] = useState(false);

  const uomName = uoms.find((u) => u.id === uomId)?.name || product.uom_id?.[1] || 'Units';
  const measure = baseIsMeasure(uomName);
  // The word actually in force — the saved one, or the implicit default. The
  // Suggest button used to hard-code 'crate' here and would quietly overwrite a
  // kg product's 'piece' with 'crate' the moment someone accepted a suggestion.
  const effPack = unitWords(uomName, packLabel, looseLabel).pack;
  // Par speaks the unit staff COUNT in. For a measure-based product with a pack
  // ("1 can ≈ 0.28 kg") that is cans, not kilograms — this factor converts at
  // the screen's edge only; the API, the stored row, and the ordering maths
  // stay in base units. Factor 1 = the base unit already is what staff count.
  const parFactor = parEntryFactor(uomName, savedPackSize.trim() === '' ? null : Number(savedPackSize));
  // What the fields held after the last load/save, PLUS the exact base values
  // the server holds. An untouched bound must keep its stored value to the
  // last decimal: a legacy 5 kg par displays as "17.86 cans", and re-converting
  // THAT on a save of the other field would silently drift it to 5.0008.
  const par0 = useRef<{ min: string; max: string; minBase: number | null; maxBase: number | null }>(
    { min: '', max: '', minBase: null, maxBase: null });
  // Newest par load wins: opening the page fires one load at factor 1 before
  // the saved pack size arrives and one after — without the token, the slow
  // first response could land last and show kilograms under a cans label.
  const parReq = useRef(0);

  const loadPar = React.useCallback(() => {
    if (!companyId) return;
    const token = ++parReq.current;
    fetch(`/api/inventory/product-par?company_id=${companyId}&ids=${product.id}`)
      .then((r) => (r.ok ? r.json() : { par: [] }))
      .then((d) => {
        if (token !== parReq.current) return;
        const row = (d.par || [])[0];
        const minBase = row?.par_min ?? null;
        const maxBase = row?.par_max ?? null;
        const min = minBase != null ? String(parToEntry(minBase, parFactor)) : '';
        const max = maxBase != null ? String(parToEntry(maxBase, parFactor)) : '';
        par0.current = { min, max, minBase, maxBase };
        setParMin(min);
        setParMax(max);
      })
      .catch(() => {});
  }, [companyId, product.id, parFactor]);
  useEffect(() => { loadPar(); }, [loadPar]);
  // savePar's failure path reloads via this ref: the closure's own loadPar may
  // belong to a product/company the screen has already left, and reloading
  // THAT would paint the wrong par (and baseline) over the current one.
  const loadParRef = useRef(loadPar);
  loadParRef.current = loadPar;

  async function savePar(nextMin: string, nextMax: string) {
    if (readOnly || !companyId) return;
    const p0 = par0.current;
    if (nextMin === p0.min && nextMax === p0.max) return;
    // "1.2.3" or a lone "." slips the input filter; converting its NaN would
    // store a real ZERO par. Refuse it instead.
    const bad = [nextMin, nextMax].some((s) => s.trim() !== '' && !Number.isFinite(Number(s)));
    if (bad) { setParErr('That is not a number — use something like 12 or 3.5.'); return; }
    // A save supersedes any in-flight load: without this, a slow factor-change
    // load could land after the save and revert the fields to its older
    // snapshot. Keeping the token also tells us below whether the screen moved
    // to another product/company/factor while the save was in flight.
    const token = ++parReq.current;
    // Only the EDITED bound is converted from what was typed; an untouched one
    // is sent back exactly as stored.
    const minBase = nextMin === p0.min ? p0.minBase
      : nextMin.trim() === '' ? null : parToBase(Number(nextMin), parFactor);
    const maxBase = nextMax === p0.max ? p0.maxBase
      : nextMax.trim() === '' ? null : parToBase(Number(nextMax), parFactor);
    setParErr('');
    try {
      const res = await fetch('/api/inventory/product-par', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id, company_id: companyId,
          par_min: minBase, par_max: maxBase,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setParErr(d.error || 'Could not save the par level'); loadParRef.current(); return; }
      if (token !== parReq.current) return;  // the screen moved on — don't poison its baseline
      par0.current = { min: nextMin, max: nextMax, minBase, maxBase };
      flash('ok', 'Par level saved');
    } catch { setParErr('Network error — the par level was not saved.'); }
  }

  // "12 cans ≈ 3.36 kg = 2 boxes" — the translation under the par fields when
  // par is typed in packs. Boxes come from the biggest saved level above one
  // pack, when the chain has one.
  const parAsBase = (v: string) => {
    const base = parToBase(Number(v), parFactor);
    let out = `${round2(base)} ${uomName}`;
    const big = packChain
      .filter((l) => Number.isFinite(l.to_base) && l.to_base > parFactor)
      .sort((a, b) => b.to_base - a.to_base)[0];
    if (big) {
      const n = round2(base / big.to_base);
      out += ` = ${n} ${pluralizePack(big.name, n)}`;
    }
    return out;
  };

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
        setSavedPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
        setLooseLabel(f.loose_label || '');
        setLevelShape(f.level_shape || '');
        levelConfirmed.current = f.level_shape || '';
      }
    })
    .catch(() => {});
  useEffect(() => { loadUnits(); }, []);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(0);                                                    // newest-load token
  const [busy, setBusy] = useState<string | null>(null);      // which section is saving
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);


  useEffect(() => {
    // Only the newest load may write state. This effect re-runs when the
    // restaurant changes, and the tax it reads is per-restaurant — so a slow
    // first reply landing after a fast second would show one restaurant's tax
    // rate labelled as another's, which is a wrong number stated confidently.
    const token = ++loadRef.current;
    // Tax is per restaurant. Clear it BEFORE the new read so a company change
    // never leaves the previous restaurant's rate on screen, labelled as this
    // one's, while the request is in flight.
    setTaxOpts({ sale: [], purchase: [] });
    setSaleTax(null); setPurchaseTax(null);
    setTaxClash({ sale: false, purchase: false });
    setTaxRetired({ sale: false, purchase: false });
    (async () => {
      try {
        const [flagRes, uomRes, spotRes, locRes, masterRes, taxRes] = await Promise.all([
          fetch(`/api/inventory/product-flags?ids=${product.id}`).then((r) => r.ok ? r.json() : { flags: [] }),
          fetch('/api/inventory/uoms').then((r) => r.ok ? r.json() : { uoms: [] }),
          fetch(`/api/inventory/product-locations?product_id=${product.id}`).then((r) => r.ok ? r.json() : { location_ids: [] }),
          companyId ? fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : { locations: [] }) : { locations: [] },
          // Odoo master (manager-only) — internal ref, sales price, cost. 403 for
          // non-managers is fine; the section is hidden for them anyway.
          fetch(`/api/inventory/products/${product.id}`).then((r) => r.ok ? r.json() : { product: null }).catch(() => ({ product: null })),
          companyId
            ? fetch(`/api/products/taxes?company_id=${companyId}`).then((r) => r.ok ? r.json() : { sale: [], purchase: [] }).catch(() => ({ sale: [], purchase: [] }))
            : { sale: [], purchase: [] },
        ]);
        if (token !== loadRef.current) return;
        const m = (masterRes as any).product;
        // Tax: work out which entry on the product is THIS restaurant's, by
        // intersecting with the taxes this restaurant owns. Never by position —
        // the list is ordered by company id, so entry zero is somebody else's.
        const opts = taxRes as { sale: TaxOption[]; purchase: TaxOption[]; retired?: number[] };
        setTaxOpts({ sale: opts.sale || [], purchase: opts.purchase || [] });
        if (m) {
          const saleIds = (opts.sale || []).map((t) => t.id);
          const purchIds = (opts.purchase || []).map((t) => t.id);
          setSaleTax(currentCompanyTax(m.taxes_id || [], saleIds));
          setPurchaseTax(currentCompanyTax(m.supplier_taxes_id || [], purchIds));
          setTaxClash({
            sale: hasConflictingTax(m.taxes_id || [], saleIds),
            purchase: hasConflictingTax(m.supplier_taxes_id || [], purchIds),
          });
          // "Not set" and "set to a rate that has since been retired" look
          // identical in an empty select but need different words — 92 products
          // here are in the second state and a manager would swear they set it.
          const retired = new Set(opts.retired || []);
          const onRetired = (ids: number[]) => (ids || []).some((id) => retired.has(id));
          setTaxRetired({
            sale: onRetired(m.taxes_id || []),
            purchase: onRetired(m.supplier_taxes_id || []),
          });
          setStorable(m.is_storable === true);
          setStorableError(null);   // a stale refusal must not follow us to another product
        }
        if (m) {
          const dc = m.default_code || '';
          const lp = m.list_price != null ? String(m.list_price) : '';
          const sp = m.standard_price != null ? String(m.standard_price) : '';
          setDefaultCode(dc); setListPrice(lp); setStandardPrice(sp);
          const nt = plainFromOdooHtml(m.description);
          setNote(nt); setNote0(nt);
          setMaster0({ default_code: dc, list_price: lp, standard_price: sp });
          // Suppliers + vendor picker (manager-only, same gate as the master GET).
          Promise.all([
            fetch(`/api/inventory/products/${product.id}/suppliers`).then((r) => r.ok ? r.json() : { suppliers: [] }).catch(() => ({ suppliers: [] })),
            fetch('/api/inventory/vendors').then((r) => r.ok ? r.json() : { vendors: [] }).catch(() => ({ vendors: [] })),
            // Same token: this is un-awaited, so without the check it can land
            // after the product changed and show the previous one's suppliers.
          ]).then(([supRes, vendRes]) => {
            if (token !== loadRef.current) return;
            setSuppliers(supRes.suppliers || []); setVendors(vendRes.vendors || []);
          }).catch(() => {});
        }
        const f = (flagRes.flags || [])[0];
        if (f) {
          setRequiresPhoto(!!f.requires_photo);
          setPackLabel(f.pack_label || '');
          setPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
          setSavedPackSize(f.units_per_crate != null ? String(f.units_per_crate) : '');
          setLooseLabel(f.loose_label || '');
          setLevelShape(f.level_shape || '');
          levelConfirmed.current = f.level_shape || '';
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
      finally { if (token === loadRef.current) setLoading(false); }
    })();
  }, [product.id, companyId]);

  function flash(kind: 'ok' | 'err', text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === 'ok' ? 1800 : 4000);
  }

  /**
   * Put a scanned draft into use.
   *
   * Sends the name, category and unit currently on screen — the three Odoo needs
   * — to the approve endpoint, which activates it and clears it from the setup
   * queue. The cost is left out deliberately: it is already saved by its own
   * field above, and passing it again would let a half-typed number overwrite
   * what was stored.
   */
  async function activateDraft() {
    if (readOnly || !catId || !uomId) return;
    setBusy('activate');
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), categ_id: catId, uom_id: uomId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { flash('err', d.error || 'Could not put it in use'); return; }
      setIsDraft(false);
      setIsArchived(false);
      flash('ok', 'In use — it will show up on counts and orders now');
      // is_draft as well as active: a parent holding a cached copy would
      // otherwise still think this is a draft and show the button again on
      // reopen, and the review screen decides whether a count is blocked from
      // exactly that flag.
      onChanged({ active: true, is_draft: false });
    } catch { flash('err', 'Network error — it is still not in use.'); }
    finally { setBusy(null); }
  }

  /** "7% Vorsteuer — 7%" or "19% Umsatzst (incl.) — 19%, in the price". The real
   *  percentage travels with the name because the names in this database are not
   *  reliable: one reads "19% Vorsteuer" and is configured at 0%. */
  function taxLabel(t: TaxOption): string {
    const pct = `${Number.isInteger(t.amount) ? t.amount : t.amount.toFixed(1)}%`;
    return `${t.name} — ${pct}${t.included ? ', in the price' : ''}`;
  }

  /**
   * Tax for THIS restaurant. The server merges rather than replaces, so the
   * other restaurants' tax on the same shared product is left alone.
   *
   * Optimistic, then reverted on failure: the select must not sit showing a
   * value Odoo refused.
   */
  async function saveTax(kind: 'sale' | 'purchase', taxId: number | null) {
    if (readOnly || !companyId) return;
    const prev = kind === 'sale' ? saleTax : purchaseTax;
    const set = kind === 'sale' ? setSaleTax : setPurchaseTax;
    set(taxId);
    setBusy('tax');
    try {
      const res = await fetch(`/api/inventory/products/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          ...(kind === 'sale' ? { sale_tax_id: taxId } : { purchase_tax_id: taxId }),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { set(prev); flash('err', d.error || 'Could not save the tax'); return; }
      // Only the type just saved is resolved; the other keeps its warning.
      setTaxClash((c) => ({ ...c, [kind]: false }));
      setTaxRetired((r) => ({ ...r, [kind]: false }));
      flash('ok', taxId == null ? 'Tax cleared' : 'Tax saved');
    } catch { set(prev); flash('err', 'Network error — the tax was not saved.'); }
    finally { setBusy(null); }
  }

  /**
   * Turn stock tracking on or off. Odoo can REFUSE to turn it off once the
   * product has stock moves; that refusal is shown verbatim rather than left as
   * a switch that silently springs back.
   */
  async function saveStorable(next: boolean) {
    if (readOnly) return;
    const prev = storable;
    const pid = product.id;   // a late response must not touch another product's screen
    setStorable(next);
    setStorableError(null);
    setBusy('storable');
    try {
      const res = await fetch(`/api/inventory/products/${pid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_storable: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (productIdRef.current !== pid) return;
      if (!res.ok) {
        setStorable(prev);
        // The reason must live WHERE THE SWITCH IS, and stay put — a snapped-
        // back toggle with no visible why reads as a bug (it did to Ethan).
        setStorableError(d.error || 'Could not change this — try again.');
        flash('err', d.error || 'Could not change this');
        return;
      }
      flash('ok', next ? 'Odoo now keeps a stock number for this product' : 'Odoo no longer keeps a stock number — portal counts still work');
      onChanged({ is_storable: next });
    } catch {
      if (productIdRef.current !== pid) return;
      setStorable(prev);
      setStorableError('Network error — nothing changed. Try again.');
      flash('err', 'Network error — nothing changed.');
    }
    finally { if (productIdRef.current === pid) setBusy(null); }
  }

  async function saveMaster(patch: { name?: string; uom_id?: number; categ_id?: number; barcode?: string; default_code?: string; list_price?: number; standard_price?: number; description?: string }) {
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

  /**
   * Save ONE master field and move the baseline with it, so the next blur on an
   * untouched field is a no-op rather than a second write of the same value.
   */
  async function saveField(patch: { default_code?: string; list_price?: number; standard_price?: number }) {
    if (!master0) return;
    if (await saveMaster(patch)) {
      setMaster0({
        default_code: patch.default_code !== undefined ? patch.default_code : master0.default_code,
        list_price: patch.list_price !== undefined ? String(patch.list_price) : master0.list_price,
        standard_price: patch.standard_price !== undefined ? String(patch.standard_price) : master0.standard_price,
      });
    }
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
        onChanged({ deleted: true });
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
      onChanged({ active });
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
      setSavedPackSize(size != null ? String(size) : '');
      flash('ok', 'Saved');
      onChanged({ flags: { units_per_crate: size, pack_label: nextLabel || null, loose_label: nextLoose.trim() || null } });
    } catch { flash('err', 'Network error — not saved'); }
    finally { setBusy(null); }
  }

  const levelSeq = useRef(0);
  const levelChain = useRef<Promise<unknown>>(Promise.resolve());
  // What the SERVER last confirmed — failures roll back to this, never to a
  // previous optimistic tap that may itself have failed.
  const levelConfirmed = useRef('');
  function saveLevelShape(next: string) {
    if (readOnly) return;
    const mySeq = ++levelSeq.current;   // latest tap owns the UI
    setLevelShape(next);   // instant feedback, reverted if the server says no
    // CHAIN the writes so they reach the server in tap order — two racing PUTs
    // could otherwise land reversed and leave the database on the older choice
    // while the screen shows the newer one.
    levelChain.current = levelChain.current.then(async () => {
      try {
        const res = await fetch(`/api/inventory/product-flags/${product.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level_shape: next || null }),
        });
        if (res.ok) levelConfirmed.current = next;   // server truth moved, even if a newer tap owns the UI
        if (levelSeq.current !== mySeq) return;      // a newer tap superseded this one
        if (!res.ok) { setLevelShape(levelConfirmed.current); flash('err', 'Could not save the level diagram'); return; }
        onChanged({ flags: { level_shape: next || null } });
      } catch {
        if (levelSeq.current !== mySeq) return;
        setLevelShape(levelConfirmed.current); flash('err', 'Network error — not saved');
      }
    });
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


  async function removePhoto() {
    setPhotoMenu(false);
    setBusy('photo');
    try {
      const res = await fetch(`/api/inventory/product-images/${product.id}`, { method: 'DELETE' });
      if (!res.ok) { flash('err', 'Could not remove the photo'); return; }
      setImg(false);
      setImgVer((v) => v + 1);
      flash('ok', 'Photo removed');
      onChanged({ imageAdded: false });
    } catch { flash('err', 'Network error — the photo is still there'); }
    finally { setBusy(null); }
  }

  async function uploadPhoto(file: File) {
    if (readOnly) return;
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
          {/* WHAT IS STILL MISSING. Shown only straight after creating, and only
              while something is actually outstanding, so it is a hand-off from
              the intake sheet rather than a permanent nag. Ticks update live as
              each field saves — every item below reads the same state the
              section it points at writes. */}
          {justCreated && !readOnly && (() => {
            const items = [
              { done: img, label: 'Add a picture', why: 'so staff match it on the shelf' },
              // master0 is what Odoo HAS, not what is in the box. Reading the
              // input would tick the moment someone typed a digit, and stay
              // ticked if the save then failed.
              { done: !!master0 && master0.standard_price !== '' && Number(master0.standard_price) > 0,
                label: 'What you pay for it', why: 'gives the stock a value' },
              ...(taxOpts.purchase.length > 0 || taxOpts.sale.length > 0
                ? [{ done: purchaseTax != null || saleTax != null, label: 'Tax', why: 'for this restaurant' }] : []),
              { done: homeSpots.length > 0, label: 'Where it lives', why: 'puts it on the right counting walk' },
              { done: parMin !== '' || parMax !== '', label: 'Par level', why: 'how much to keep in' },
            ];
            const left = items.filter((i) => !i.done);
            // Only claim it is countable when it actually is. The intake switch
            // can be turned off deliberately, and then no count of it can ever
            // be saved — saying "ready to count" would be a plain untruth.
            const countable = storable !== false;
            if (left.length === 0) {
              return (
                <div className="mb-4 bg-green-50 border border-green-300 rounded-xl p-3 text-[var(--fs-sm)] font-bold text-green-800">
                  ✓ That is everything {'—'} this product is ready to {countable ? 'count and order' : 'order'}.
                </div>
              );
            }
            return (
              <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3">
                <div className="text-[var(--fs-sm)] font-bold text-gray-900 mb-0.5">Product created</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mb-2.5">
                  {countable
                    ? 'It can be counted and ordered already.'
                    : 'It can be ordered already, but it is not counted in stock — see Stock below.'}{' '}
                  {left.length} thing{left.length === 1 ? '' : 's'} would make it better:
                </div>
                <ul className="space-y-1.5">
                  {items.map((i) => (
                    <li key={i.label} className="flex items-start gap-2 text-[var(--fs-xs)]">
                      <span className={`flex-shrink-0 mt-[1px] ${i.done ? 'text-green-600' : 'text-gray-300'}`} aria-hidden="true">
                        {i.done ? '✓' : '○'}
                      </span>
                      <span className={i.done ? 'text-gray-400 line-through' : 'text-gray-700'}>
                        <span className="font-semibold">{i.label}</span>
                        <span className="text-gray-400"> {'—'} {i.why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {/* PHOTO.
              Tapping the picture SHOWS it, full screen and zoomable — that is
              what a person expects a picture to do, and it is the thing that
              actually helps someone matching a label on a shelf. Replacing and
              removing live behind the ⋯ in the corner, the way Odoo does it,
              so a mis-tap can no longer overwrite the photo. */}
          {photoChooser && (
            <PhotoSourceSheet
              title="Product picture"
              onFile={(f: File) => void uploadPhoto(f)}
              onClose={() => setPhotoChooser(false)}
            />
          )}
          <DropZone onFiles={(fs) => uploadPhoto(fs[0])} disabled={busy === 'photo' || readOnly}
            className="mb-4" hint={img ? 'Drop to replace the photo' : 'Drop the photo here'}>
            {img ? (
              <div className="relative w-full rounded-2xl border border-gray-200 bg-white overflow-hidden">
                {/* object-CONTAIN, not cover.
                    A product photo has to show the PRODUCT. `object-cover` fills
                    the box by cropping, so on a wide screen a tall bottle was
                    trimmed to its middle — a yellow band with no label and no
                    shape, useless to someone trying to recognise it on a shelf.
                    Contain fits the whole thing inside a fixed-height frame; the
                    frame keeps its height so the form below does not jump around
                    as photos of different shapes load. */}
                <button onClick={() => setViewer(true)}
                  className="block w-full h-56 sm:h-72 bg-gray-50 active:opacity-90"
                  aria-label={`See the photo of ${product.name} full screen`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/inventory/product-images/${product.id}?v=${imgVer}`} alt={product.name}
                    className="w-full h-full object-contain" />
                </button>
                {!readOnly && (
                  <button onClick={() => setPhotoMenu(true)} disabled={busy === 'photo'}
                    aria-label="Replace or remove this photo"
                    className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center active:bg-black/70 disabled:opacity-40">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>
                )}
              </div>
            ) : (
              <button onClick={() => setPhotoChooser(true)} disabled={busy === 'photo' || readOnly}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 bg-white overflow-hidden active:opacity-80 disabled:opacity-50"
                aria-label="Add a product photo">
                <div className="py-10 text-center text-gray-400">
                  <div className="text-3xl mb-1">📷</div>
                  <div className="text-[var(--fs-sm)] font-semibold">Add a photo {'—'} camera, upload, or drag one in</div>
                </div>
              </button>
            )}
          </DropZone>

          {/* WHAT IT IS CALLED. Name, internal reference and barcode are the three
              ways a person or a scanner identifies this thing, so they sit
              together. The reference used to live under "Selling & cost", where
              it had nothing to do with either. */}
          <label className={label} htmlFor="pd-name">Name</label>
          <input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            disabled={readOnly}
            onBlur={() => { const v = name.trim(); if (v.length >= 2 && v !== product.name) saveMaster({ name: v }); }}
            className={`${box} mb-4`} />

          {master0 && !readOnly && (
            <>
              <label className={label} htmlFor="pd-ref">Internal reference</label>
              <input id="pd-ref" value={defaultCode} onChange={(e) => setDefaultCode(e.target.value)} maxLength={64}
                placeholder="e.g. BBQ-HOT-40"
                onBlur={() => { if (defaultCode !== master0.default_code) saveField({ default_code: defaultCode.trim() }); }}
                className={`${box} mb-4`} />
            </>
          )}

          {!readOnly && (
            <>
              <label className={label} htmlFor="pd-note">Note</label>
              <textarea id="pd-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000}
                placeholder="Anything worth knowing — where it hides, how to spot it, who to ask"
                onBlur={async () => {
                  if (note === note0) return;
                  if (await saveMaster({ description: note })) setNote0(note);
                }}
                className={`${box} mb-1 min-h-[76px] py-2.5`} />
              <p className="text-[var(--fs-xs)] text-gray-400 mb-4">
                Staff see this while counting. It is the same note as in Odoo.
              </p>
            </>
          )}

          {/* Money. Kept as its own block because it is the one thing here that
              changes what a dish earns, but saved the same way as everything
              else — the screen had three different rules for committing a
              change, which is one more than anybody can learn. */}
          {master0 && !readOnly && (
            <div className="mb-4">
              <label className={label}>Selling & cost</label>
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Sales price</div>
                    <NumberField
                      value={listPrice === '' ? null : Number(listPrice)}
                      onValueChange={(v) => setListPrice(v === null ? '' : String(v))}
                      onCommit={(v) => {
                        const next = v === null ? '' : String(v);
                        setListPrice(next);
                        if (next !== master0.list_price && next !== '') saveField({ list_price: Number(next) });
                      }}
                      mode="decimal" allowEmpty min={0} fractionDigits={2} unit="\u20ac"
                      aria-label="Sales price" placeholder="0.00" inputClassName={box} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Cost</div>
                    <NumberField
                      value={standardPrice === '' ? null : Number(standardPrice)}
                      onValueChange={(v) => setStandardPrice(v === null ? '' : String(v))}
                      onCommit={(v) => {
                        const next = v === null ? '' : String(v);
                        setStandardPrice(next);
                        if (next !== master0.standard_price && next !== '') saveField({ standard_price: Number(next) });
                      }}
                      mode="decimal" allowEmpty min={0} fractionDigits={2} unit="\u20ac"
                      aria-label="Cost" placeholder="0.00" inputClassName={box} />
                  </div>
                </div>
                <p className="text-[var(--fs-xs)] text-gray-400 mt-2.5">Writes to Odoo {'—'} affects sales &amp; margins.</p>
              </div>
            </div>
          )}

          {/* TAX. Two fields, not one, because Odoo keeps two and they are not
              the same money: what a supplier charges you and what you charge a
              customer. An ingredient you never sell needs only the first.

              Per restaurant, on a record most restaurants share — so the write
              merges rather than replaces (see lib/product-tax.ts). The real
              percentage is printed beside every name because names lie: this
              company has one called "19% Vorsteuer" configured at 0%. */}
          {master0 && !readOnly && companyId && (taxOpts.sale.length > 0 || taxOpts.purchase.length > 0) && (
            <div className="mb-4">
              <label className={label}>Tax</label>
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                {taxOpts.purchase.length > 0 && (
                  <div>
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Tax when buying it</div>
                    <select value={purchaseTax ?? ''} disabled={busy === 'tax'}
                      onChange={(e) => saveTax('purchase', e.target.value === '' ? null : Number(e.target.value))}
                      className={box}>
                      <option value="">Not set</option>
                      {taxOpts.purchase.map((t) => (
                        <option key={t.id} value={t.id}>{taxLabel(t)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {taxOpts.sale.length > 0 && (
                  <div>
                    <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">Tax when selling it</div>
                    <select value={saleTax ?? ''} disabled={busy === 'tax'}
                      onChange={(e) => saveTax('sale', e.target.value === '' ? null : Number(e.target.value))}
                      className={box}>
                      <option value="">Not sold {'—'} leave empty</option>
                      {taxOpts.sale.map((t) => (
                        <option key={t.id} value={t.id}>{taxLabel(t)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-[var(--fs-xs)] text-gray-400">
                  This restaurant only. The other restaurants keep their own tax on this product.
                </p>
                {(taxRetired.sale || taxRetired.purchase) && !(taxClash.sale || taxClash.purchase) && (
                  <p className="text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    The {taxRetired.sale && taxRetired.purchase ? 'buying and selling taxes'
                      : taxRetired.sale ? 'selling tax' : 'buying tax'} on this product
                    {taxRetired.sale && taxRetired.purchase ? ' have' : ' has'} been retired in Odoo,
                    so it shows as blank above. Pick a current one.
                  </p>
                )}
                {(taxClash.sale || taxClash.purchase) && (
                  <p className="text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    This product carries more than one {taxClash.sale && taxClash.purchase
                      ? 'buying AND selling tax'
                      : taxClash.sale ? 'selling tax' : 'buying tax'} for this restaurant,
                    which Odoo cannot resolve. Choosing one above replaces them with it.
                  </p>
                )}
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
                  <NumberField
                    value={addPrice === '' ? null : Number(addPrice)}
                    onValueChange={(v) => setAddPrice(v === null ? '' : String(v))}
                    onCommit={(v) => setAddPrice(v === null ? '' : String(v))}
                    mode="decimal" allowEmpty min={0} fractionDigits={2} unit="\u20ac"
                    aria-label="Supplier price" placeholder="Price"
                    inputClassName="w-20 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] text-center" />
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

          {/* TRACK INVENTORY. The most consequential switch on this screen and
              the one nothing in the portal has ever set: Odoo 18 asks "is this a
              physical good?" and "do we track how much of it we hold?" as two
              separate questions, and the second defaults to NO. With it off the
              product has no stock figure, so an approved count has nowhere to
              write — silently. Stated here in those terms rather than as
              "is_storable". Managers only, because the value arrives with the
              manager-gated master read — a viewer has no way to see it. */}
          {storable !== null && (
            <div className="mb-4">
              <label className={label}>Stock</label>
              <div className={`border rounded-xl p-3 ${storable ? 'bg-white border-gray-200' : 'bg-amber-50 border-amber-300'}`}>
                <button type="button" disabled={readOnly || busy === 'storable'}
                  onClick={() => saveStorable(!storable)}
                  aria-pressed={storable}
                  className="w-full flex items-center gap-3 text-left disabled:opacity-60">
                  <span className={`flex-shrink-0 w-11 h-[26px] rounded-full transition-colors relative ${storable ? 'bg-green-600' : 'bg-gray-300'}`}>
                    <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all ${storable ? 'left-[23px]' : 'left-[3px]'}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[var(--fs-sm)] font-bold text-gray-900">Count this in stock</span>
                    <span className="block text-[var(--fs-xs)] text-gray-500">
                      {storable
                        ? 'Odoo keeps a quantity for this product, so counts save.'
                        : 'Odoo keeps NO stock number for this product. Counts still save in the portal — but Odoo\u2019s own quantity stays empty until this is on.'}
                    </span>
                  </span>
                </button>
                {storableError && (
                  <div className="mt-2.5 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[var(--fs-xs)] text-red-700 font-semibold leading-snug">
                    {storableError}
                  </div>
                )}
                {!storable && !readOnly && (
                  <p className="text-[var(--fs-xs)] text-gray-500 mt-2.5 pl-[56px]">
                    Leave it off only for things you never count {'—'} a service, or a fee.
                  </p>
                )}
              </div>
            </div>
          )}

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
              <NumberField
                value={packSize === '' ? null : Number(packSize)}
                disabled={readOnly}
                onValueChange={(v) => setPackSize(v === null ? '' : String(v))}
                onCommit={(v) => {
                  const next = v === null ? '' : String(v);
                  setPackSize(next);
                  savePack(next, effPack, looseLabel);
                }}
                mode="decimal" allowEmpty min={0} placeholder="—"
                aria-label={`How many ${uomName} in one ${effPack}`}
                inputClassName="w-16 h-9 border border-gray-300 rounded-lg text-center font-mono font-semibold" />
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

          {/* Container-level diagram — measure-base + pack size only. Staff mark
              the open container's level by eye instead of guessing litres. */}
          {measure && (
            <>
              <label className={label}>Level diagram for the open {effPack}</label>
              <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
                <div className="flex gap-2 flex-wrap items-stretch">
                  {[['', 'Off'], ['round', 'Round bucket'], ['rect', 'Rect. bucket'], ['barrel', 'Barrel'], ['bottle', 'Bottle']].map(([val, lbl]) => (
                    <button key={val} type="button" disabled={readOnly || (val !== '' && savedPackSize === '')}
                      aria-pressed={levelShape === val}
                      onClick={() => saveLevelShape(val)}
                      className={`min-h-[44px] min-w-[76px] px-3 py-2 rounded-xl border transition-colors disabled:opacity-40 flex flex-col items-center justify-center gap-1 ${
                        levelShape === val ? 'bg-blue-50 border-blue-600 ring-1 ring-blue-600' : 'bg-white border-gray-200 active:bg-gray-50'
                      }`}>
                      {/* the drawing itself IS the choice — staff-recognisable, per Ethan */}
                      {val !== '' && <ContainerLevelGlyph shape={val as ContainerShape} fraction={0.75} height={30} />}
                      <span className={`text-[var(--fs-xs)] font-bold ${levelShape === val ? 'text-blue-800' : 'text-gray-600'}`}>{lbl}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">
                  {savedPackSize === ''
                    ? `Needs the pack size above first — the drawing converts a marked level into ${uomName}.`
                    : levelShape
                      ? `Staff mark the open ${effPack}’s level by eye — quarter steps — and the count adds that amount in ${uomName}.`
                      : `Off: staff count whole ${pluralizePack(effPack, 2)} only, as before.`}
                </p>
              </div>
            </>
          )}

          {/* PAR — the least and the most of this you want to hold HERE.
              Directly under the pack settings on purpose: par is typed in base
              units, and the line below turns it into packs so nobody has to do
              the arithmetic in their head. */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4">
            <div className="flex items-baseline justify-between gap-2">
              <label className={label}>Par level</label>
              <span className="text-[var(--fs-xs)] text-gray-400">this restaurant only</span>
            </div>
            <div className="flex gap-2 mt-1">
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-xs)] text-gray-500 mb-1">Least (min)</div>
                <NumberField
                  value={parMin === '' ? null : Number(parMin)}
                  disabled={readOnly}
                  onValueChange={(v) => setParMin(v === null ? '' : String(v))}
                  onCommit={(v) => {
                    const next = v === null ? '' : String(v);
                    setParMin(next);
                    savePar(next, parMax);
                  }}
                  mode="decimal" allowEmpty min={0}
                  placeholder="—" aria-label="Least you want to hold"
                  inputClassName={`${box} text-center font-mono`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-xs)] text-gray-500 mb-1">Most (max)</div>
                <NumberField
                  value={parMax === '' ? null : Number(parMax)}
                  disabled={readOnly}
                  onValueChange={(v) => setParMax(v === null ? '' : String(v))}
                  onCommit={(v) => {
                    const next = v === null ? '' : String(v);
                    setParMax(next);
                    savePar(parMin, next);
                  }}
                  mode="decimal" allowEmpty min={0}
                  placeholder="—" aria-label="Most you want to hold"
                  inputClassName={`${box} text-center font-mono`} />
              </div>
            </div>
            {parErr && <p className="text-[var(--fs-xs)] font-semibold text-red-600 mt-1.5">{parErr}</p>}
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">
              {parFactor !== 1 ? (
                // Par typed in the unit staff COUNT (cans), translated to what
                // the system stores (kg) — and boxes, when the chain knows one.
                <>
                  In {pluralizePack(effPack, 2)}
                  {(parMin !== '' || parMax !== '') && (
                    <>
                      {' — '}
                      {parMin !== '' && `${parMin} ${pluralizePack(effPack, Number(parMin))} ≈ ${parAsBase(parMin)}`}
                      {parMin !== '' && parMax !== '' && ', '}
                      {parMax !== '' && `${parMax} ${pluralizePack(effPack, Number(parMax))} ≈ ${parAsBase(parMax)}`}
                    </>
                  )}
                  . {parMin !== '' ? `Below ${parMin} ${pluralizePack(effPack, Number(parMin))}, ordering suggests topping up${parMax !== '' ? ` to ${parMax}` : ''}.` : 'Leave blank for no par.'}
                </>
              ) : (
                <>
                  In {unitWords(uomName, effPack, looseLabel).looseFor(2)}
                  {Number(packSize) > 0 && (parMin !== '' || parMax !== '') && (
                    <>
                      {' — '}
                      {parMin !== '' && `${parMin} = ${(Number(parMin) / Number(packSize)).toFixed(2).replace(/\.?0+$/, '')} ${pluralizePack(effPack, 2)}`}
                      {parMin !== '' && parMax !== '' && ', '}
                      {parMax !== '' && `${parMax} = ${(Number(parMax) / Number(packSize)).toFixed(2).replace(/\.?0+$/, '')} ${pluralizePack(effPack, 2)}`}
                    </>
                  )}
                  . {parMin !== '' ? `Below ${parMin}, ordering suggests topping up${parMax !== '' ? ` to ${parMax}` : ''}.` : 'Leave blank for no par.'}
                </>
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
            onLevels={onChainLevels}
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
          <input id="pd-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={readOnly}
            placeholder="Scan or type…"
            onBlur={() => { const v = barcode.trim(); if (v !== (product.barcode || '')) saveMaster({ barcode: v }); }}
            className={`${box} font-mono mb-8`} />

          {/* A DRAFT is not archived and must not be offered the archive/delete
              pair: it is a product scanned mid-count that nobody has finished, so
              the only thing to do with it is put it in use. Without this the
              screen showed "Archive this product" for something that was never in
              use — and nothing anywhere could activate it, so "Finish it" on the
              setup queue led to a page with no way to finish. */}
          {isDraft && !readOnly && (
            <>
              <label className={label}>Not in use yet</label>
              <div className="mb-8 rounded-xl border border-green-300 bg-green-50 p-3">
                <p className="text-[var(--fs-xs)] text-green-900 mb-2.5">
                  This was created from a barcode scanned during a count. It stays out of counts,
                  orders and the till until you put it in use.
                </p>
                <button onClick={activateDraft} disabled={!!busy || !catId || !uomId}
                  className="w-full h-12 rounded-xl bg-green-600 text-white font-bold active:bg-green-700 disabled:opacity-50">
                  {busy === 'activate' ? 'Putting it in use…' : 'Put it in use'}
                </button>
                {(!catId || !uomId) && (
                  <p className="text-[var(--fs-xs)] text-green-800 mt-2">
                    Pick a category and a unit above first.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Taking a product out of use. Archive reads as the ordinary action
              because it is the one that almost always applies; delete sits
              under it and looks like what it is. */}
          {!isDraft && !readOnly && (
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

      {/* The picture, full screen and zoomable — the shared viewer, not a
          second one. Sits ABOVE this sheet, hence the baseZ. */}
      <PhotoLightbox
        open={viewer}
        photos={[`/api/inventory/product-images/${product.id}?v=${imgVer}`]}
        caption={product.name}
        baseZ={baseZ + 20}
        onClose={() => setViewer(false)}
      />

      {/* Replace / remove, behind the ⋯ so neither can happen by mis-tapping
          the picture. */}
      {photoMenu && (
        <div className="fixed inset-0 flex items-end" role="dialog" aria-modal="true" aria-label="Photo options"
          style={{ zIndex: baseZ + 15 }}>
          <button aria-label="Close" onClick={() => setPhotoMenu(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full bg-white rounded-t-3xl pb-[env(safe-area-inset-bottom)] sm:max-w-sm sm:mx-auto sm:mb-6 sm:rounded-3xl">
            <div className="px-5 pt-4 pb-2">
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">Photo</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 [overflow-wrap:anywhere]">{product.name}</div>
            </div>
            <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
              <button onClick={() => { setPhotoMenu(false); setPhotoChooser(true); }}
                className="w-full h-12 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">
                Replace photo
              </button>
              <button onClick={removePhoto}
                className="w-full h-12 rounded-xl border border-red-200 text-red-600 font-bold active:bg-red-50">
                Remove photo
              </button>
              <button onClick={() => setPhotoMenu(false)}
                className="w-full h-11 rounded-xl border border-gray-200 text-gray-600 font-bold active:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
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
