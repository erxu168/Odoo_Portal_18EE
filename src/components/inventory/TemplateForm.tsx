'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BackHeader, SearchBar, ProductThumb, leafCategory } from './ui';
import SpotSheet from './SpotSheet';
import AddProductsSheet from './AddProductsSheet';
import ProductDetail from './ProductDetail';
import RecordLink from '@/components/ui/RecordLink';
import { recordHref } from '@/lib/record-links';
import { useCompany } from '@/lib/company-context';
import { pluralizePack } from '@/lib/crate-units';

const FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  // 'monthly' hidden: not implemented in shouldGenerateToday() so it never
  // auto-generates a session. Re-add here once monthly scheduling is built.
  { id: 'adhoc', label: 'Ad-hoc' },
];

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

const ASSIGN_TYPES = [
  { id: 'person', label: 'Person' },
  { id: 'department', label: 'Dept' },
  { id: 'shift', label: 'Shift' },
];

interface TemplateFormProps {
  template: any | null;
  locations: any[];
  departments: any[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export default function TemplateForm({ template, departments, onSave, onCancel }: TemplateFormProps) {
  const { companyId, stockLocationId } = useCompany();
  const [name, setName] = useState(template?.name || '');
  const [frequency, setFrequency] = useState(template?.frequency || 'adhoc');
  const [adhocDate, setAdhocDate] = useState<string>(template?.adhoc_date || '');
  const [scheduleDays, setScheduleDays] = useState<number[]>(template?.schedule_days || []);
  const [locationId, setLocationId] = useState<number | null>(template?.location_id || null);
  const [assignType, setAssignType] = useState<string | null>(template?.assign_type || null);
  const [assignId, setAssignId] = useState<number | null>(template?.assign_id || null);
  const [active, setActive] = useState(template?.active !== false);
  const [saving, setSaving] = useState(false);

  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(
    new Set(template?.product_ids || [])
  );
  const [productImageIds, setProductImageIds] = useState<Set<number>>(new Set()); // products with a picture
  const [flags, setFlags] = useState<Record<number, any>>({});      // productId -> count config (pack_label, units_per_crate) for the unit hint
  // HOME SPOTS — the global product↔spot record every door edits. The map shows
  // each row's spot chips; the SpotSheet edits them (saved immediately).
  const [homeSpots, setHomeSpots] = useState<Record<number, number[]>>({});     // productId -> spot ids
  const [spotLabels, setSpotLabels] = useState<Record<number, string>>({});     // spot id -> "Area · Spot"
  const [spotSheetFor, setSpotSheetFor] = useState<any | null>(null);           // product whose spots are being edited
  const [productEditFor, setProductEditFor] = useState<any | null>(null);       // drill-down: product editor overlay
  const [canEditProduct, setCanEditProduct] = useState(false);                  // capability for product master edits
  const [shiftTemplates, setShiftTemplates] = useState<any[]>([]);  // Planning shift templates (Opening/Mid/Closing) for "assign to a shift"
  const [shiftLoadFailed, setShiftLoadFailed] = useState(false);    // fetch failed/forbidden ≠ "no shifts exist" — don't lie in the hint
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');           // filter within THIS LIST
  const [addOpen, setAddOpen] = useState(false);       // Add-products sheet

  const [step, setStep] = useState<'config' | 'products'>('config');
  const [portalUsers, setPortalUsers] = useState<any[]>([]);

  const isEdit = !!template?.id;

  // Product master edits need their own capability (a template manager may lack
  // it) — the drill-down still opens, just read-only, per the drill-down standard.
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.ok ? r.json() : null).then((d) => {
      const caps: string[] = d?.user?.capabilities || [];
      setCanEditProduct(caps.includes('inventory.productsettings.manage'));
    }).catch(() => {});
  }, []);

  // Home-spot map + spot labels for the chips (one request each). Failure is
  // non-fatal — chips just show "No spot yet" until the sheet is opened.
  useEffect(() => {
    if (!companyId) return;
    let stale = false;
    // Reset first — a failed load must show "no data", never the PREVIOUS
    // restaurant's chips.
    setHomeSpots({});
    setSpotLabels({});
    (async () => {
      try {
        const [plRes, locRes] = await Promise.all([
          fetch(`/api/inventory/product-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('placements'))),
          fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('locations'))),
        ]);
        if (stale) return;
        const map: Record<number, number[]> = {};
        (plRes.placements || []).forEach((p: any) => {
          (map[p.odoo_product_id] ||= []).push(p.count_location_id);
        });
        setHomeSpots(map);
        const locs: any[] = locRes.locations || [];
        const byId = new Map<number, any>(locs.map((l) => [l.id, l]));
        const labels: Record<number, string> = {};
        locs.forEach((l) => {
          const parent = l.parent_id != null ? byId.get(l.parent_id) : null;
          labels[l.id] = parent ? `${parent.name} · ${l.name}` : l.name;
        });
        setSpotLabels(labels);
      } catch { /* chips degrade gracefully */ }
    })();
    return () => { stale = true; };
  }, [companyId]);

  useEffect(() => {
    // Cancellation guard: after a company switch (or unmount) this run's late
    // responses must NOT write state — else company A's slower fetch can
    // overwrite company B's products/shifts after the switch reset.
    let stale = false;
    async function load() {
      try {
        // When editing, also fetch the template's already-selected products by
        // explicit ids — they must stay visible even if outside the company's
        // relevant set (e.g. selected before the relevance filter existed).
        const selectedIds: number[] = template?.product_ids || [];
        const [prodRes, userRes, selRes, imgRes] = await Promise.all([
          fetch(`/api/inventory/products?limit=500&include_pos=1${companyId ? `&company_id=${companyId}&relevant=1` : ''}`),
          fetch('/api/admin/users'),
          selectedIds.length > 0
            ? fetch(`/api/inventory/products?ids=${selectedIds.join(',')}&limit=1000`)
            : null,
          // Isolated so a network error here can't abort product/user loading —
          // thumbnails just fall back to the placeholder.
          fetch('/api/inventory/product-images').catch(() => null),
        ]);
        try {
          const imgData = imgRes ? await imgRes.json() : null;
          if (imgData && !stale) setProductImageIds(new Set<number>(imgData.with_images || []));
        } catch { /* thumbnails just fall back to the placeholder */ }
        const prodData = await prodRes.json();
        let prods = (prodData.products || []).filter((p: any) => p.active !== false);
        if (selRes) {
          try {
            const selData = await selRes.json();
            const seen = new Set(prods.map((p: any) => p.id));
            for (const p of (selData.products || [])) {
              if (p.active !== false && !seen.has(p.id)) prods = [...prods, p];
            }
          } catch { /* ignore — browse list alone still works */ }
        }
        if (stale) return;
        setAllProducts(prods);
        try {
          const userData = await userRes.json();
          if (!stale) setPortalUsers((userData.users || []).filter((u: any) => u.employee_id));
        } catch { /* ignore user fetch errors */ }
        // Per-product count config (pack unit + kg conversion) so the editor can show
        // "counted in bunches -> kg" inline, without opening Product settings.
        try {
          const flagData = await fetch('/api/inventory/product-flags').then((r) => r.json());
          const fmap: Record<number, any> = {};
          for (const f of (flagData.flags || [])) fmap[f.odoo_product_id] = f;
          if (!stale) setFlags(fmap);
        } catch { /* count-unit hints are best-effort */ }
        // Shift templates (Opening/Mid/Closing) from the Planning module, so the
        // "assign to a shift" picker is populated instead of empty.
        if (companyId) {
          try {
            const stData = await fetch(`/api/shifts/templates?company_id=${companyId}`).then((r) => r.json());
            if (stale) return;
            if (Array.isArray(stData.templates)) setShiftTemplates(stData.templates);
            else setShiftLoadFailed(true);   // e.g. 403 for an override-granted staff account
          } catch { if (!stale) setShiftLoadFailed(true); }
        }
      } catch (err) {
        console.error('Failed to load products:', err);
      } finally {
        if (!stale) setLoadingProducts(false);
      }
    }
    load();
    return () => { stale = true; };
  }, [companyId]);

  useEffect(() => {
    if (locationId) return;
    // The list's stock location follows the active company (blue ribbon), not a
    // manual pick. Deliberately NO fallback to some other location: the parent's
    // locations list spans every company the manager may see, so borrowing its
    // first entry could silently target another restaurant (the server would
    // reject it with an unactionable error). No warehouse → explicit notice.
    if (stockLocationId) setLocationId(stockLocationId);
  }, [locationId, stockLocationId]);
  // New list for a company that has no warehouse configured in Odoo — can't be
  // saved; say so instead of a silently disabled button.
  const noWarehouse = !locationId && !stockLocationId;

  // A blue-ribbon company SWITCH mid-form must re-derive everything company-owned:
  // the warehouse location (create only — an edited list keeps its own), the shift
  // options (the big load effect refetches them for the new company), and a shift
  // pick that belonged to the previous company. Ref-guarded so it fires only on a
  // real switch, not on the initial company/warehouse arriving after mount.
  const prevCompanyRef = useRef<number>(companyId);
  const [companyChangedMidEdit, setCompanyChangedMidEdit] = useState(false);
  useEffect(() => {
    if (!companyId) return;                 // provider still hydrating — not a switch
    if (prevCompanyRef.current === 0) {     // first REAL company arriving ≠ a switch
      prevCompanyRef.current = companyId;
      return;
    }
    if (prevCompanyRef.current === companyId) return;
    prevCompanyRef.current = companyId;
    if (!isEdit) setLocationId(stockLocationId || null);
    // Mid-EDIT the list still belongs to its own restaurant, but the form's data
    // (products, departments, shifts) now loads for the NEW one — a save would
    // mix companies. Block it and ask for a reopen.
    else setCompanyChangedMidEdit(true);
    setShiftTemplates([]);
    setShiftLoadFailed(false);
    if (assignType === 'shift') setAssignId(null);
  }, [companyId, stockLocationId, isEdit, assignType]);

  // Clear schedule_days when frequency changes away from weekly
  useEffect(() => {
    if (frequency !== 'weekly') {
      setScheduleDays([]);
    }
  }, [frequency]);

  function toggleDay(dayId: number) {
    setScheduleDays((prev) => {
      if (prev.includes(dayId)) {
        return prev.filter((d) => d !== dayId);
      }
      return [...prev, dayId];
    });
  }

  const selectedProducts = useMemo(() => {
    return allProducts.filter((p) => selectedProductIds.has(p.id));
  }, [allProducts, selectedProductIds]);

  // "Counted in bunches · 1 bunch ≈ 0.05 kg" — how staff count this item + its base
  // conversion (from product_flags). Display-only here; managed in Product settings.
  function unitHint(p: any): string {
    const base = p.uom_id?.[1] || 'Units';
    const f = flags[p.id];
    if (f?.pack_label) {
      // The practical unit staff count in; the kg/base conversion is optional
      // (a "bunch" can be configured without an average weight).
      const packs = `Counted in ${pluralizePack(f.pack_label, 2)}`;
      return f.units_per_crate ? `${packs} · 1 ${f.pack_label} ≈ ${f.units_per_crate} ${base}` : packs;
    }
    return `Counted in ${base} (base unit)`;
  }

  // Group a product list by category, showing the LEAF name only (keep the id as the
  // key since two full paths can share a leaf name).
  function groupByCategory(list: any[]): { id: number; name: string; items: any[] }[] {
    const groups = new Map<number, { id: number; name: string; items: any[] }>();
    for (const p of list) {
      const id = p.categ_id?.[0] ?? 0;
      if (!groups.has(id)) groups.set(id, { id, name: leafCategory(p.categ_id?.[1] || '') || 'Uncategorised', items: [] });
      groups.get(id)!.items.push(p);
    }
    return Array.from(groups.values());
  }

  function toggleProduct(productId: number) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function removeProduct(productId: number) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }

  const selectedCount = selectedProductIds.size;
  const needsDays = frequency === 'weekly' && scheduleDays.length === 0;
  const needsAdhocDate = frequency === 'adhoc' && !adhocDate;
  const needsAssignee = !!assignType && !assignId;   // typed assignment must name someone
  const canSave = name.trim().length > 0 && locationId !== null && selectedCount > 0 && !needsDays && !needsAdhocDate && !needsAssignee && !companyChangedMidEdit;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    const catIdSet = new Set<number>();
    allProducts
      .filter((p) => selectedProductIds.has(p.id))
      .forEach((p) => { if (p.categ_id?.[0]) catIdSet.add(p.categ_id[0]); });
    const catIds = Array.from(catIdSet);
    await onSave({
      ...(isEdit ? { id: template.id } : {}),
      name: name.trim(),
      frequency,
      schedule_days: frequency === 'weekly' ? scheduleDays : [],
      adhoc_date: frequency === 'adhoc' ? adhocDate : null,
      location_id: locationId,
      // Which restaurant — drives tablet visibility. On edit, preserve the
      // list's own restaurant (there's no company picker here) so switching the
      // active company can't silently re-tag it; only a legacy untagged list
      // falls back to the active company.
      company_id: (isEdit ? (template?.company_id ?? companyId) : companyId) || undefined,
      category_ids: catIds,
      product_ids: Array.from(selectedProductIds),
      // Spot placements are deliberately NOT sent: the server leaves stored
      // placements untouched when no array is present, so editing a list never
      // wipes its guided spot layout. (Spot assignment gets its own UI later.)
      assign_type: assignType,
      assign_id: assignId,
      active,
    });
    setSaving(false);
  }

  // ========== PRODUCT PICKER STEP ==========
  if (step === 'products') {
    // THE LIST is the screen: only what's been added, grouped by category, with
    // spot chips + remove. Adding happens in the search-first AddProductsSheet —
    // no 200-row checkbox wall to lose your place in.
    const listFiltered = search
      ? selectedProducts.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      : selectedProducts;
    return (
      <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
          <button onClick={() => setStep('config')} className="flex items-center gap-1 text-gray-500 text-[var(--fs-base)] font-semibold active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          <div className="text-center">
            <div className="text-[var(--fs-lg)] font-bold text-gray-900">This list</div>
            <div className="text-[var(--fs-xs)] text-gray-500">{selectedCount} product{selectedCount !== 1 ? 's' : ''}</div>
          </div>
          <button onClick={() => setStep('config')}
            className="bg-green-600 text-white text-[var(--fs-base)] font-bold px-4 py-2 rounded-xl active:bg-green-700 shadow-sm">
            Done
          </button>
        </div>

        {selectedCount === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-3">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </div>
            <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Nothing on this list yet</p>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-5 max-w-[240px]">Add the products staff should count — search or browse by category.</p>
          </div>
        ) : (
          <>
            {selectedCount > 12 && (
              <SearchBar value={search} onChange={setSearch} placeholder="Find on this list..." />
            )}
            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
              <div className="flex flex-col gap-4">
                {groupByCategory(listFiltered).map((group) => (
                  <div key={group.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-green-700 bg-green-50 px-4 py-2 border-b border-gray-100">
                      {group.name} <span className="text-gray-400 font-semibold">({group.items.length})</span>
                    </div>
                    {group.items.map((p) => (
                      <div key={p.id} className="border-b border-gray-100 last:border-b-0 px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                            <div className="text-[var(--fs-xs)] text-gray-400 truncate">{unitHint(p)}</div>
                          </div>
                          {/* Drill-down: open the product itself (fix name / unit / photo) */}
                          <RecordLink type="product" id={p.id} label={p.name} onOpen={() => setProductEditFor(p)} />
                          <button onClick={() => removeProduct(p.id)} aria-label={`Remove ${p.name} from the list`}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </div>
                        <button onClick={() => setSpotSheetFor(p)} aria-label={`Change where ${p.name} is counted`}
                          className="mt-1 flex flex-wrap gap-1 pl-[52px] text-left active:opacity-80">
                          {(homeSpots[p.id] || []).length > 0 ? (
                            (homeSpots[p.id] || []).map((sid) => (
                              <span key={sid} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                                📍 {spotLabels[sid] || `Spot ${sid}`}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-dashed border-amber-300">
                              📍 No spot yet — tap to set
                            </span>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="px-4 pb-4 pt-2 bg-gray-50">
          <button onClick={() => setAddOpen(true)}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-xl)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            + Add products
          </button>
        </div>

        {addOpen && (
          <AddProductsSheet
            products={allProducts}
            selectedIds={selectedProductIds}
            onToggle={toggleProduct}
            onAddMany={(ids) => setSelectedProductIds((prev) => new Set([...Array.from(prev), ...ids]))}
            productImageIds={productImageIds}
            homeSpots={homeSpots}
            spotLabels={spotLabels}
            unitHint={unitHint}
            onEditProduct={(p) => setProductEditFor(p)}
            onClose={() => setAddOpen(false)}
          />
        )}

        {spotSheetFor && companyId && (
          <SpotSheet
            product={spotSheetFor}
            hasImage={productImageIds.has(spotSheetFor.id)}
            companyId={companyId}
            initialSpotIds={homeSpots[spotSheetFor.id] || []}
            onSaved={(ids) => setHomeSpots((m) => ({ ...m, [spotSheetFor.id]: ids }))}
            onClose={() => setSpotSheetFor(null)}
          />
        )}

        {/* Drill-down overlay: the product's own editor, stacked ABOVE the add
            sheet (baseZ 120) so the half-built list underneath is untouched.
            "Full page ↗" lets the manager leave the flow deliberately. */}
        {productEditFor && (
          <ProductDetail
            product={productEditFor}
            hasImage={productImageIds.has(productEditFor.id)}
            readOnly={!canEditProduct}
            baseZ={120}
            fullPageHref={recordHref('product', productEditFor.id)}
            onClose={() => setProductEditFor(null)}
            onChanged={(patch) => {
              if (patch.name === undefined && patch.uom === undefined) return;
              setAllProducts((prev) => prev.map((x) => x.id === productEditFor.id
                ? { ...x, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.uom !== undefined ? { uom_id: patch.uom } : {}) }
                : x));
              setProductEditFor((cur: any) => cur && cur.id === productEditFor.id
                ? { ...cur, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.uom !== undefined ? { uom_id: patch.uom } : {}) }
                : cur);
            }}
          />
        )}
      </div>
    );
  }


  // ========== CONFIG STEP ==========
  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
      <BackHeader onBack={onCancel}
        title={isEdit ? `Edit: ${template.name}` : 'New counting list'}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-4">
          {/* Name */}
          <div className="mb-5">
            <label className="block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">List name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily bar count"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-base)] text-gray-900 placeholder-gray-400 outline-none focus:border-green-500 transition-colors" />
          </div>

          {/* Frequency */}
          <div className="mb-5">
            <label className="block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Frequency</label>
            <div className="flex gap-2 flex-wrap">
              {FREQUENCIES.map((f) => (
                <button key={f.id} onClick={() => setFrequency(f.id)}
                  className={`px-4 py-2.5 rounded-xl text-[var(--fs-base)] font-semibold border transition-all ${
                    frequency === f.id
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-white border-gray-200 text-gray-500'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Day-of-week picker — only for weekly */}
          {frequency === 'weekly' && (
            <div className="mb-5">
              <label className="block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">
                Which days?
              </label>
              <div className="flex gap-2">
                {WEEKDAYS.map((day) => {
                  const isActive = scheduleDays.includes(day.id);
                  return (
                    <button key={day.id} onClick={() => toggleDay(day.id)}
                      className={`flex-1 py-2.5 rounded-xl text-[var(--fs-base)] font-semibold border transition-all text-center ${
                        isActive
                          ? 'bg-purple-50 border-purple-300 text-purple-800'
                          : 'bg-white border-gray-200 text-gray-400'
                      }`}>
                      {day.label}
                    </button>
                  );
                })}
              </div>
              {scheduleDays.length === 0 && (
                <p className="text-[var(--fs-xs)] text-amber-600 mt-1.5 font-medium">
                  Select at least one day for this list to auto-generate.
                </p>
              )}
            </div>
          )}

          {companyChangedMidEdit && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
              <p className="text-[var(--fs-sm)] font-semibold text-amber-800">
                You switched restaurants while editing. Close this list and reopen it to keep everything consistent.
              </p>
            </div>
          )}

          {noWarehouse && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
              <p className="text-[var(--fs-sm)] font-semibold text-amber-800">
                This restaurant has no warehouse set up in Odoo yet, so counting lists can&rsquo;t be created for it.
              </p>
            </div>
          )}

          {/* Ad-hoc date — the single day this one-off list is due */}
          {frequency === 'adhoc' && (
            <div className="mb-5">
              <label className="block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Count date</label>
              <input type="date" value={adhocDate} onChange={(e) => setAdhocDate(e.target.value)}
                min={new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-500 transition-colors" />
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">The single day this one-off list appears for counting.</p>
            </div>
          )}

          {/* Location picker removed — the list belongs to the company selected in the
              blue ribbon (the single source of truth). location_id is derived, not chosen. */}

          {/* Assign to */}
          <div className="mb-5">
            <label className="block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Assign to</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={() => { setAssignType(null); setAssignId(null); }}
                className={`px-4 py-2.5 rounded-xl text-[var(--fs-base)] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                  !assignType ? 'bg-green-50 border-green-200 text-green-800' : 'bg-white border-gray-200 text-gray-500'
                }`}>
                Anyone
              </button>
              {ASSIGN_TYPES.map((at) => (
                <button key={at.id} onClick={() => { setAssignType(at.id); setAssignId(null); }}
                  className={`px-4 py-2.5 rounded-xl text-[var(--fs-base)] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                    assignType === at.id ? 'bg-green-50 border-green-200 text-green-800' : 'bg-white border-gray-200 text-gray-500'
                  }`}>
                  {at.label}
                </button>
              ))}
            </div>

            {assignType === 'department' && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[var(--fs-base)] text-gray-900 outline-none">
                  <option value="">Choose department...</option>
                  {departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.member_count} members)</option>
                  ))}
                </select>
              </div>
            )}

            {assignType === 'person' && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[var(--fs-base)] text-gray-900 outline-none">
                  <option value="">Choose person...</option>
                  {portalUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
                {portalUsers.length === 0 && (
                  <p className="text-[var(--fs-xs)] text-gray-400 mt-1">No staff accounts with linked employees found</p>
                )}
              </div>
            )}

            {assignType === 'shift' && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[var(--fs-base)] text-gray-900 outline-none">
                  <option value="">Choose shift...</option>
                  {shiftTemplates.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.startHHMM ? ` · ${s.startHHMM}–${s.endHHMM}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                  {shiftLoadFailed
                    ? 'Couldn’t load the shifts — close and reopen this list to retry.'
                    : shiftTemplates.length === 0
                      ? 'No shifts yet — add them in the Planning module.'
                      : 'Shown as a label on the count — the whole restaurant can still open it.'}
                </p>
              </div>
            )}
          </div>

          {isEdit && (
            <div className="mb-5">
              <button onClick={() => setActive(!active)}
                className="flex items-center justify-between w-full bg-white border border-gray-200 rounded-xl px-4 py-3">
                <span className="text-[var(--fs-base)] font-semibold text-gray-900">Active</span>
                <div className={`w-11 h-6 rounded-full relative transition-colors ${active ? 'bg-green-600' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Products section */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-500">
              Products ({selectedCount})
            </label>
            <button onClick={() => setStep('products')}
              className="text-green-700 text-[var(--fs-sm)] font-semibold active:opacity-70">
              {selectedCount === 0 ? '+ Add products' : 'Edit selection'}
            </button>
          </div>

          {selectedCount === 0 ? (
            <button onClick={() => setStep('products')}
              className="w-full bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 text-center active:bg-gray-50 transition-colors">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </div>
              <div className="text-[var(--fs-base)] font-semibold text-gray-900">Add products to this list</div>
              <div className="text-[var(--fs-sm)] text-gray-500 mt-1">Browse, search, and select products</div>
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              {groupByCategory(selectedProducts).map((group) => (
                <div key={group.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-green-700 bg-green-50 px-4 py-2 border-b border-gray-100">
                    {group.name} <span className="text-gray-400 font-semibold">({group.items.length})</span>
                  </div>
                  {group.items.map((p, idx) => (
                    <div key={p.id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${idx < group.items.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                        <div className="text-[var(--fs-xs)] text-gray-400 truncate">{unitHint(p)}</div>
                      </div>
                      <button onClick={() => removeProduct(p.id)} aria-label={`Remove ${p.name}`}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spacer for save button */}
        <div className="h-24" />
      </div>

      {/* Save button - fixed at bottom, high z-index */}
      <div className="px-4 pb-4 pt-2">
        <button onClick={handleSubmit} disabled={saving || !canSave}
          className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-xl)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-40 disabled:shadow-none">
          {saving
            ? 'Saving...'
            : companyChangedMidEdit
              ? 'Restaurant changed — reopen this list'
              : noWarehouse
                ? 'No warehouse for this restaurant'
                : needsAdhocDate
              ? 'Pick a date first'
              : needsDays
                ? 'Select days first'
                : needsAssignee
                  ? 'Choose an assignee first'
                  : selectedCount === 0
                ? 'Add products to save'
                : isEdit
                  ? `Save changes (${selectedCount} products)`
                  : `Create counting list (${selectedCount} products)`
          }
        </button>
      </div>
    </div>
  );
}
