'use client';

import React, { useState, useEffect, useMemo } from 'react';

interface CreateMoProps {
  onBack: () => void;
  onCreated: (moId: number) => void;
}

export default function CreateMo({ onBack, onCreated }: CreateMoProps) {
  // Step: 'select' (pick product) | 'configure' (qty + options) | 'review'
  const [step, setStep] = useState<'select' | 'configure' | 'review'>('select');

  // BOM list for product selection
  const [boms, setBoms] = useState<any[]>([]);
  const [bomsLoading, setBomsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  // Selected BOM + detail
  const [selectedBom, setSelectedBom] = useState<any>(null);
  const [components, setComponents] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Configuration
  const [qty, setQty] = useState('1');
  const [sqcEnabled, setSqcEnabled] = useState(false);
  const [drivingCompId, setDrivingCompId] = useState<number | null>(null);
  const [drivingCompQty, setDrivingCompQty] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split('T')[0]);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creatingSubMo, setCreatingSubMo] = useState<number | null>(null);
  const [createdSubMos, setCreatedSubMos] = useState<Record<number, number>>({});
  const [parentMoId, setParentMoId] = useState<number | null>(null);

  // Fetch all BOMs on mount
  useEffect(() => {
    async function loadBoms() {
      try {
        const res = await fetch('/api/boms');
        const data = await res.json();
        setBoms(data.boms || []);
      } catch (e) {
        console.error('Failed to load BOMs:', e);
      } finally {
        setBomsLoading(false);
      }
    }
    loadBoms();
  }, []);

  // Categories from BOMs — deduplicated, "All" only once at the front
  const categories = useMemo(() => {
    const cats = Array.from(new Set(boms.map((b: any) => b.category || 'Uncategorized'))).sort();
    return ['All', ...cats.filter(c => c !== 'All')];
  }, [boms]);

  // Filtered BOMs
  const filtered = useMemo(() => {
    return boms.filter((b: any) => {
      const matchSearch = !search || b.product_tmpl_id[1].toLowerCase().includes(search.toLowerCase());
      const matchCategory = activeCategory === 'All' || b.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [boms, search, activeCategory]);

  // Select a product/BOM and fetch its detail
  async function selectProduct(bom: any) {
    setDetailLoading(true);
    setSelectedBom(bom);
    try {
      const res = await fetch(`/api/boms/${bom.id}`);
      const data = await res.json();
      setSelectedBom(data.bom);
      setComponents(data.components || []);
      setQty(String(data.bom?.product_qty || 1));
      setStep('configure');
    } catch (e) {
      console.error('Failed to load BOM detail:', e);
    } finally {
      setDetailLoading(false);
    }
  }

  // Quantity helpers
  const numQty = parseFloat(qty) || 0;
  const baseQty = selectedBom?.product_qty || 1;
  const ratio = baseQty > 0 ? numQty / baseQty : 0;
  const uom = selectedBom?.product_uom_id?.[1] || 'kg';

  // Scaled components with availability
  const scaledComps = useMemo(() => {
    return components.map((c: any) => {
      const scaled = Math.round(c.required_qty * ratio * 1000) / 1000;
      const short = scaled - c.on_hand_qty;
      return {
        ...c,
        scaled_qty: scaled,
        is_short: short > 0,
        short_amount: Math.max(0, Math.round(short * 1000) / 1000),
      };
    });
  }, [components, ratio]);

  // Max producible based on stock
  const maxProducible = useMemo(() => {
    if (!components.length || baseQty <= 0) return 0;
    let minQty = Infinity;
    for (const c of components) {
      if (c.required_qty > 0) {
        minQty = Math.min(minQty, (c.on_hand_qty / c.required_qty) * baseQty);
      }
    }
    return minQty === Infinity ? 0 : Math.floor(minQty);
  }, [components, baseQty]);

  // Shortcuts
  const shortcuts = useMemo(() => {
    if (!baseQty) return [];
    return [0.5, 1, 1.5, 2, 3].map((m) => ({
      label: new Intl.NumberFormat('de-DE').format(Math.round(baseQty * m)),
      value: Math.round(baseQty * m),
    }));
  }, [baseQty]);

  // Driving component
  const drivingComp = useMemo(() => {
    if (!sqcEnabled || !drivingCompId) return null;
    return components.find((c: any) => c.product_id === drivingCompId) || null;
  }, [sqcEnabled, drivingCompId, components]);

  useEffect(() => {
    if (sqcEnabled && drivingComp) {
      const manualQty = parseFloat(drivingCompQty);
      if (!isNaN(manualQty) && manualQty > 0 && drivingComp.required_qty > 0) {
        setQty(String(Math.round((manualQty / drivingComp.required_qty) * baseQty * 100) / 100));
      }
    }
  }, [sqcEnabled, drivingComp, drivingCompQty, baseQty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sqcEnabled && !drivingCompId && components.length) {
      setDrivingCompId(components[0].product_id);
    }
  }, [sqcEnabled, components, drivingCompId]);

  const shortComps = scaledComps.filter((c: any) => c.is_short);

  // Resolve the correct product_id for MO creation
  // Use resolved_product_id (from BOM detail API) > product_id > product_tmpl_id
  function getProductId(): number {
    if (selectedBom.resolved_product_id) return selectedBom.resolved_product_id;
    if (selectedBom.product_id && selectedBom.product_id[0]) return selectedBom.product_id[0];
    return selectedBom.product_tmpl_id[0];
  }

  // Get company_id from the BOM
  function getCompanyId(): number | undefined {
    if (selectedBom.company_id && selectedBom.company_id[0]) return selectedBom.company_id[0];
    return undefined;
  }

  // Submit
  async function handleConfirm() {
    if (!selectedBom || numQty <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let moId = parentMoId;

      if (moId) {
        // Parent MO already exists as draft — update qty and confirm
        await fetch(`/api/manufacturing-orders/${moId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_qty: numQty }),
        });
      } else {
        // Create new MO
        const body: any = {
          product_id: getProductId(),
          bom_id: selectedBom.id,
          product_qty: numQty,
          product_uom_id: selectedBom.product_uom_id[0],
          date_deadline: scheduledDate,
        };
        const companyId = getCompanyId();
        if (companyId) body.company_id = companyId;

        const res = await fetch('/api/manufacturing-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.id) throw new Error('No MO ID returned');
        moId = data.id;
      }

      // Confirm the parent MO
      const cr = await fetch(`/api/manufacturing-orders/${moId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      });
      const cd = await cr.json();
      if (cd.error) throw new Error(cd.error);

      // Also confirm any draft sub-MOs
      for (const subMoId of Object.values(createdSubMos)) {
        try {
          await fetch(`/api/manufacturing-orders/${subMoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm' }),
          });
        } catch { /* best effort */ }
      }

      onCreated(moId!);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    if (!selectedBom || numQty <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let moId = parentMoId;
      if (moId) {
        // Already saved — just update qty
        await fetch(`/api/manufacturing-orders/${moId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_qty: numQty }),
        });
      } else {
        const body: any = {
          product_id: getProductId(),
          bom_id: selectedBom.id,
          product_qty: numQty,
          product_uom_id: selectedBom.product_uom_id[0],
          date_deadline: scheduledDate,
        };
        const companyId = getCompanyId();
        if (companyId) body.company_id = companyId;

        const res = await fetch('/api/manufacturing-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.id) throw new Error('No MO ID returned');
        moId = data.id;
      }
      onCreated(moId!);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to save draft');
    } finally {
      setSubmitting(false);
    }
  }


  async function handleCreateSubMo(comp: any) {
    if (!comp.sub_bom_id) return;
    const needed = comp.short_amount;
    if (!confirm(`Create draft MO for ${comp.product_name}?\n\nQuantity: ${fmt(needed)} ${comp.uom}\n\nYour current order will also be saved as draft.`)) return;
    setCreatingSubMo(comp.product_id);
    try {
      // Step 1: Save the PARENT MO as draft first (so it's not lost)
      if (!parentMoId) {
        const parentBody: any = {
          product_id: getProductId(),
          bom_id: selectedBom.id,
          product_qty: numQty,
          product_uom_id: selectedBom.product_uom_id[0],
          date_deadline: scheduledDate,
        };
        const companyId = getCompanyId();
        if (companyId) parentBody.company_id = companyId;

        const parentRes = await fetch('/api/manufacturing-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parentBody),
        });
        const parentData = await parentRes.json();
        if (parentData.error) throw new Error(parentData.error);
        setParentMoId(parentData.id);
      }

      // Step 2: Fetch sub-BOM to get product_id and uom
      const bomRes = await fetch(`/api/boms/${comp.sub_bom_id}`);
      const bomData = await bomRes.json();
      if (!bomData.bom) throw new Error('Sub-BOM not found');

      const subBom = bomData.bom;
      const productId = subBom.resolved_product_id || subBom.product_id?.[0] || subBom.product_tmpl_id[0];

      // Step 3: Create the sub-MO as DRAFT (not auto-confirmed)
      const body: any = {
        product_id: productId,
        bom_id: comp.sub_bom_id,
        product_qty: needed,
        product_uom_id: subBom.product_uom_id[0],
      };
      if (subBom.company_id?.[0]) body.company_id = subBom.company_id[0];

      const res = await fetch('/api/manufacturing-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Store the created sub-MO ID
      setCreatedSubMos(prev => ({ ...prev, [comp.product_id]: data.id }));
    } catch (err: any) {
      alert(err.message || 'Failed to create sub-MO');
    } finally {
      setCreatingSubMo(null);
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

  // === STEP 1: Select Product ===
  if (step === 'select') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
          <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
          <div className="flex items-center gap-3 relative">
            <button onClick={onBack} className="w-11 h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[var(--fs-xl)] font-bold text-white">Start manufacturing</h1>
              <p className="text-[var(--fs-xs)] text-white/50 mt-0.5">Step 1 &mdash; Select a recipe</p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-4 py-2.5">
          <div className="flex-1 h-1 rounded-full bg-green-600" />
          <div className="flex-1 h-1 rounded-full bg-gray-200" />
          <div className="flex-1 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Search */}
        <div className="px-4 pt-1">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text" placeholder="Search recipes..." value={search}
              onChange={(e) => setSearch(e.target.value)} autoFocus
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-base)] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 px-4 py-2.5 overflow-x-auto no-scrollbar">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-4 py-3 rounded-full text-[var(--fs-sm)] font-bold whitespace-nowrap transition-all ${
                activeCategory === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'
              }`}>{cat}</button>
          ))}
        </div>

        {/* Product list */}
        <div className="px-4 pb-6">
          {bomsLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-[var(--fs-sm)]">No recipes found</div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((bom: any) => (
                <button key={bom.id} onClick={() => selectProduct(bom)}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex justify-between items-center text-left w-full active:scale-[0.98] transition-transform">
                  <div className="min-w-0 flex-1">
                    <div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">{bom.product_tmpl_id[1]}</div>
                    <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                      {bom.component_count} ingredients &middot; {fmt(bom.product_qty)} {bom.product_uom_id[1]} per batch
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {detailLoading && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
            <div className="w-10 h-10 border-3 border-white border-t-green-600 rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  // === STEP 2: Configure Quantity ===
  if (step === 'configure' && selectedBom) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
          <button onClick={() => { setStep('select'); setSelectedBom(null); setComponents([]); }}
            className="flex items-center gap-1 mb-2 text-green-700 text-[var(--fs-xs)] font-semibold active:opacity-70">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Change recipe
          </button>
          <h1 className="text-[var(--fs-lg)] font-bold text-gray-900">{selectedBom.product_tmpl_id[1]}</h1>
          <p className="text-[var(--fs-xs)] text-gray-500 mt-0.5">Step 2 &mdash; Set quantity</p>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-4 py-2.5">
          <div className="flex-1 h-1 rounded-full bg-green-500" />
          <div className="flex-1 h-1 rounded-full bg-green-600" />
          <div className="flex-1 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="px-4 pt-2 pb-28">
          {/* Driving component toggle */}
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3">
            <div>
              <div className="text-[var(--fs-sm)] text-gray-900 font-bold">Set qty by ingredient</div>
              <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">Enter ingredient amount to calculate output</div>
            </div>
            <button onClick={() => { setSqcEnabled(!sqcEnabled); if (sqcEnabled) { setQty(String(baseQty)); setDrivingCompQty(''); } }}
              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${sqcEnabled ? 'bg-green-600' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sqcEnabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>

          {sqcEnabled && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-3">
              <label className="text-[12px] font-semibold text-green-800 tracking-wider uppercase mb-1.5 block">Driving ingredient</label>
              <select value={drivingCompId || ''} onChange={(e) => { setDrivingCompId(parseInt(e.target.value) || null); setDrivingCompQty(''); }}
                className="w-full px-3 py-2.5 rounded-lg border border-green-200 bg-white text-[var(--fs-sm)] font-semibold text-green-800 mb-2">
                <option value="">Select ingredient...</option>
                {components.map((c: any) => <option key={c.product_id} value={c.product_id}>{c.product_name} ({c.uom})</option>)}
              </select>
              {drivingCompId && drivingComp && (
                <div>
                  <label className="text-[12px] font-semibold text-green-800 tracking-wider uppercase mb-1.5 block">How much {drivingComp.product_name} do you have?</label>
                  <div className="flex items-center border border-green-200 rounded-lg bg-white overflow-hidden">
                    <input type="number" inputMode="decimal" value={drivingCompQty} onChange={(e) => setDrivingCompQty(e.target.value)}
                      placeholder={`e.g. ${drivingComp.required_qty || 0}`}
                      className="flex-1 px-3 py-2.5 text-lg font-bold border-none bg-transparent focus:outline-none text-green-700 placeholder:text-gray-300" />
                    <div className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">{drivingComp.uom || 'kg'}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quantity input */}
          <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Quantity to produce{sqcEnabled ? ' (calculated)' : ''}</label>
          <div className="flex items-center border border-gray-200 rounded-xl bg-white overflow-hidden mb-1.5">
            <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} readOnly={sqcEnabled}
              className={`flex-1 px-4 py-3 text-[var(--fs-xxl)] font-bold border-none bg-transparent focus:outline-none ${sqcEnabled ? 'text-green-600' : 'text-gray-900'}`} />
            <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-l border-gray-200">{uom}</div>
          </div>
          <div className="text-[var(--fs-xs)] text-gray-400 mb-3 px-1">
            Base: {fmt(baseQty)}{uom} &middot; Ratio: {ratio.toFixed(2)}x
            {sqcEnabled && drivingComp ? ` &middot; Based on ${drivingComp.product_name}` : ''}
          </div>

          {/* Quick pick buttons */}
          {!sqcEnabled && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {shortcuts.map((s) => (
                <button key={s.value} onClick={() => setQty(String(s.value))}
                  className={`px-5 py-3 rounded-full text-[var(--fs-sm)] font-bold border transition-all ${
                    numQty === s.value ? 'bg-green-50 text-green-800 border-green-200' : 'bg-white text-gray-500 border-gray-200'
                  }`}>{s.label} {uom}</button>
              ))}
            </div>
          )}

          {/* Date */}
          <div className="mb-4">
            <label className="text-[12px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 block">Production date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-sm)] text-gray-900" />
          </div>

          {/* Component availability */}
          {parentMoId && (
            <div className="mb-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[13px] text-blue-700 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Parent order saved as draft. Sub-orders will be confirmed together.
            </div>
          )}
          <div className="text-[var(--fs-xs)] font-bold text-gray-500 tracking-widest uppercase mb-2">Ingredient availability ({scaledComps.length})</div>

          {shortComps.length > 0 && (
            <div className="mb-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-[15px] text-red-700">
              <strong>{shortComps.length}</strong> ingredient{shortComps.length > 1 ? 's' : ''} short for {fmt(numQty)} {uom}.
              Max possible: <strong>{fmt(maxProducible)} {uom}</strong>
            </div>
          )}
          {shortComps.length === 0 && scaledComps.length > 0 && (
            <div className="mb-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl text-[15px] text-green-700 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              All {scaledComps.length} ingredients available
            </div>
          )}

          <div className="flex flex-col gap-1.5 mb-4">
            {(() => {
              const cats = Array.from(new Set(scaledComps.map((c: any) => c.category || 'Other')));
              return cats.map(cat => {
                const catItems = scaledComps.filter((c: any) => (c.category || 'Other') === cat);
                return (
                  <div key={cat} className="mb-3">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-1.5 flex justify-between">
                      <span>{cat}</span>
                      <span className="font-mono text-gray-300">{catItems.length}</span>
                    </div>
                    {catItems.map((c: any) => {
              const pct = c.scaled_qty > 0 ? Math.min(100, Math.round(c.on_hand_qty / c.scaled_qty * 100)) : 100;
              return (
                <div key={c.product_id} className={`bg-white border rounded-xl px-3.5 py-3 mb-1.5 ${c.is_short ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[var(--fs-base)] font-bold truncate ${c.is_short ? 'text-red-700' : 'text-gray-900'}`}>{c.product_name}</span>
                      {c.is_sub_bom && <span className="text-[var(--fs-xs)] px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-bold flex-shrink-0">RECIPE</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {c.is_short && <span className="text-[12px] px-2 py-0.5 rounded bg-red-50 text-red-600 font-bold">SHORT</span>}
                      <span className={`text-[var(--fs-base)] font-bold font-mono ${c.is_short ? 'text-red-600' : 'text-green-600'}`}>{fmt(c.on_hand_qty)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${c.is_short ? (pct >= 50 ? 'bg-amber-400' : 'bg-red-400') : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[var(--fs-sm)] font-bold text-gray-700 min-w-[80px] text-right">{fmt(c.scaled_qty)} {c.uom} need</span>
                  </div>
                  {c.is_sub_bom && c.is_short && !createdSubMos[c.product_id] && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCreateSubMo(c); }}
                      disabled={creatingSubMo === c.product_id}
                      className="mt-2 w-full py-2.5 rounded-lg bg-blue-600 text-white text-[var(--fs-sm)] font-bold flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-50"
                    >
                      {creatingSubMo === c.product_id ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                      )}
                      {creatingSubMo === c.product_id ? 'Creating...' : `Produce ${fmt(c.short_amount)} ${c.uom}`}
                    </button>
                  )}
                  {c.is_sub_bom && createdSubMos[c.product_id] && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCreated(createdSubMos[c.product_id]); }}
                      className="mt-2 w-full py-2.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[var(--fs-sm)] font-bold flex items-center justify-center gap-2 active:bg-green-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                      Draft MO created — Open to review
                    </button>
                  )}
                </div>
              );
            })}
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Bottom CTA */}
        {submitError && (
          <div className="fixed bottom-24 left-0 right-0 max-w-lg mx-auto px-4">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-[var(--fs-xs)]">{submitError}</div>
          </div>
        )}
        <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 pb-8 pt-2 bg-gradient-to-t from-gray-50">
          <button onClick={handleConfirm} disabled={submitting || numQty <= 0}
            className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-md)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50 mb-2">
            {submitting ? 'Creating...' : `Confirm order (${fmt(numQty)} ${uom})`}
          </button>
          <button onClick={handleSaveDraft} disabled={submitting || numQty <= 0}
            className="w-full py-3 rounded-xl border border-green-300 text-green-700 font-bold text-[var(--fs-base)] active:scale-[0.975] transition-transform disabled:opacity-50">
            Save as draft
          </button>
        </div>
      </div>
    );
  }

  // Fallback loading
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
    </div>
  );
}
