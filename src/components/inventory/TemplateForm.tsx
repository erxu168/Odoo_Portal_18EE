'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BackHeader, FilterBar, FilterPill, SearchBar, Spinner } from './ui';

const FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'adhoc', label: 'Ad-hoc' },
];

const ASSIGN_TYPES = [
  { id: 'person', label: 'Person' },
  { id: 'department', label: 'Department' },
  { id: 'shift', label: 'Shift' },
];

interface TemplateFormProps {
  template: any | null;
  locations: any[];
  departments: any[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export default function TemplateForm({ template, locations, departments, onSave, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(template?.name || '');
  const [frequency, setFrequency] = useState(template?.frequency || 'adhoc');
  const [locationId, setLocationId] = useState<number | null>(template?.location_id || null);
  const [assignType, setAssignType] = useState<string | null>(template?.assign_type || null);
  const [assignId, setAssignId] = useState<number | null>(template?.assign_id || null);
  const [active, setActive] = useState(template?.active !== false);
  const [saving, setSaving] = useState(false);

  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(
    new Set(template?.product_ids || [])
  );
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'selected' | 'unselected'>('all');

  const [step, setStep] = useState<'config' | 'products'>('config');

  const isEdit = !!template?.id;

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/inventory/products?limit=500');
        const data = await res.json();
        setAllProducts(data.products || []);
      } catch (err) {
        console.error('Failed to load products:', err);
      } finally {
        setLoadingProducts(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  const categories = useMemo(() => {
    const catMap = new Map<number, { id: number; name: string; count: number }>();
    for (const p of allProducts) {
      if (p.categ_id) {
        const [id, catName] = p.categ_id;
        const existing = catMap.get(id);
        if (existing) existing.count++;
        else catMap.set(id, { id, name: catName, count: 1 });
      }
    }
    return Array.from(catMap.values()).sort((a, b) => b.count - a.count);
  }, [allProducts]);

  const filteredProducts = useMemo(() => {
    let list = allProducts.slice();
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') list = list.filter((p) => p.categ_id?.[0] === Number(catFilter));
    if (selectionFilter === 'selected') list = list.filter((p) => selectedProductIds.has(p.id));
    if (selectionFilter === 'unselected') list = list.filter((p) => !selectedProductIds.has(p.id));
    return list;
  }, [allProducts, search, catFilter, selectionFilter, selectedProductIds]);

  // Selected products for review list
  const selectedProducts = useMemo(() => {
    return allProducts.filter((p) => selectedProductIds.has(p.id));
  }, [allProducts, selectedProductIds]);

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

  function selectAllVisible() {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      for (const p of filteredProducts) next.add(p.id);
      return next;
    });
  }

  function deselectAllVisible() {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      for (const p of filteredProducts) next.delete(p.id);
      return next;
    });
  }

  function selectByCategory(catId: number) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      for (const p of allProducts) {
        if (p.categ_id?.[0] === catId) next.add(p.id);
      }
      return next;
    });
  }

  const selectedCount = selectedProductIds.size;
  const canSave = name.trim().length > 0 && locationId !== null && selectedCount > 0;

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
      location_id: locationId,
      category_ids: catIds,
      product_ids: Array.from(selectedProductIds),
      assign_type: assignType,
      assign_id: assignId,
      active,
    });
    setSaving(false);
  }

  // ========== PRODUCT PICKER STEP ==========
  if (step === 'products') {
    return (
      <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
          <button onClick={() => setStep('config')} className="flex items-center gap-1 text-gray-500 text-[13px] font-semibold active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          <div className="text-center">
            <div className="text-[15px] font-bold text-gray-900">Select products</div>
            <div className="text-[11px] text-gray-500">{selectedCount} selected</div>
          </div>
          <button onClick={() => setStep('config')}
            className="bg-green-600 text-white text-[13px] font-bold px-4 py-2 rounded-xl active:bg-green-700 shadow-sm">
            Done
          </button>
        </div>

        <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === String(c.id)}
              label={c.name} count={c.count}
              onClick={() => setCatFilter(String(c.id))} />
          ))}
        </FilterBar>

        <FilterBar>
          <FilterPill active={selectionFilter === 'all'} label={`All (${allProducts.length})`} onClick={() => setSelectionFilter('all')} />
          <FilterPill active={selectionFilter === 'selected'} label={`Selected (${selectedCount})`} onClick={() => setSelectionFilter('selected')} />
          <FilterPill active={selectionFilter === 'unselected'} label={`Unselected (${allProducts.length - selectedCount})`} onClick={() => setSelectionFilter('unselected')} />
        </FilterBar>

        <div className="flex gap-2 px-4 pb-2">
          <button onClick={selectAllVisible}
            className="flex-1 py-2 rounded-lg bg-green-50 border border-green-200 text-green-800 text-[12px] font-semibold active:bg-green-100">
            Select all visible ({filteredProducts.length})
          </button>
          <button onClick={deselectAllVisible}
            className="flex-1 py-2 rounded-lg bg-white border border-gray-200 text-gray-500 text-[12px] font-semibold active:bg-gray-50">
            Deselect all visible
          </button>
        </div>

        {catFilter !== 'all' && (
          <div className="px-4 pb-2">
            <button onClick={() => selectByCategory(Number(catFilter))}
              className="w-full py-2.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[12px] font-semibold active:bg-green-100">
              Add entire category ({categories.find(c => String(c.id) === catFilter)?.name})
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-28">
          {loadingProducts ? <Spinner /> : filteredProducts.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-gray-400">No products match filters</div>
          ) : (
            <div className="flex flex-col">
              {filteredProducts.map((p) => {
                const isSelected = selectedProductIds.has(p.id);
                const uom = p.uom_id?.[1] || 'Units';
                const catName = p.categ_id?.[1] || '';
                return (
                  <button key={p.id} onClick={() => toggleProduct(p.id)}
                    className={`flex items-center gap-3 py-3 border-b border-gray-100 text-left active:bg-gray-50 transition-colors ${
                      isSelected ? '' : 'opacity-60'
                    }`}>
                    <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white'
                    }`}>
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-gray-900 truncate">{p.name}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{catName} &middot; {uom}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-[61] px-4 pb-4 pt-2 bg-white border-t border-gray-200">
          <button onClick={() => setStep('config')}
            className="w-full py-4 rounded-2xl bg-green-600 text-white text-[16px] font-bold shadow-xl shadow-green-600/40 active:bg-green-700 active:scale-[0.975] transition-all">
            Done &mdash; {selectedCount} product{selectedCount !== 1 ? 's' : ''} selected
          </button>
        </div>
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
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">List name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily bar count"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-500 transition-colors" />
          </div>

          {/* Frequency */}
          <div className="mb-5">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Frequency</label>
            <div className="flex gap-2 flex-wrap">
              {FREQUENCIES.map((f) => (
                <button key={f.id} onClick={() => setFrequency(f.id)}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                    frequency === f.id
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-white border-gray-200 text-gray-500'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="mb-5">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Location</label>
            <div className="flex gap-2 flex-wrap">
              {locations.map((loc: any) => (
                <button key={loc.id} onClick={() => setLocationId(loc.id)}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                    locationId === loc.id
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-white border-gray-200 text-gray-500'
                  }`}>
                  {loc.complete_name?.split('/')[0] || loc.name}
                </button>
              ))}
            </div>
          </div>

          {/* Assign to */}
          <div className="mb-5">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Assign to</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={() => { setAssignType(null); setAssignId(null); }}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                  !assignType ? 'bg-green-50 border-green-200 text-green-800' : 'bg-white border-gray-200 text-gray-500'
                }`}>
                Anyone
              </button>
              {ASSIGN_TYPES.map((at) => (
                <button key={at.id} onClick={() => { setAssignType(at.id); setAssignId(null); }}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                    assignType === at.id ? 'bg-green-50 border-green-200 text-green-800' : 'bg-white border-gray-200 text-gray-500'
                  }`}>
                  {at.label}
                </button>
              ))}
            </div>

            {assignType === 'department' && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
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
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                  <option value="">Choose person...</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Portal users will appear once employees are linked</p>
              </div>
            )}

            {assignType === 'shift' && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                  <option value="">Choose shift...</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Planning roles will appear once configured in Odoo</p>
              </div>
            )}
          </div>

          {isEdit && (
            <div className="mb-5">
              <button onClick={() => setActive(!active)}
                className="flex items-center justify-between w-full bg-white border border-gray-200 rounded-xl px-4 py-3">
                <span className="text-[14px] font-semibold text-gray-900">Active</span>
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
            <label className="text-[11px] font-semibold tracking-wide uppercase text-gray-500">
              Products ({selectedCount})
            </label>
            <button onClick={() => setStep('products')}
              className="text-green-700 text-[12px] font-semibold active:opacity-70">
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
              <div className="text-[14px] font-semibold text-gray-900">Add products to this list</div>
              <div className="text-[12px] text-gray-500 mt-1">Browse, search, and select products</div>
            </button>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {selectedProducts.map((p, idx) => {
                const uom = p.uom_id?.[1] || 'Units';
                const catName = p.categ_id?.[1] || '';
                return (
                  <div key={p.id}
                    className={`flex items-center gap-3 px-4 py-2.5 ${idx < selectedProducts.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">{p.name}</div>
                      <div className="text-[11px] text-gray-400">{catName} &middot; {uom}</div>
                    </div>
                    <button onClick={() => removeProduct(p.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Spacer for save button */}
        <div className="h-24" />
      </div>

      {/* Save button - fixed at bottom, high z-index */}
      <div className="fixed bottom-0 left-0 right-0 z-[61] px-4 pb-4 pt-2 bg-white border-t border-gray-200">
        <button onClick={handleSubmit} disabled={saving || !canSave}
          className="w-full py-4 rounded-2xl bg-green-600 text-white text-[16px] font-bold shadow-xl shadow-green-600/40 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-40 disabled:shadow-none">
          {saving
            ? 'Saving...'
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
