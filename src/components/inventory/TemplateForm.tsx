'use client';

import React, { useState, useEffect } from 'react';
import { BackHeader, Spinner } from './ui';

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
  const [selectedCats, setSelectedCats] = useState<number[]>(template?.category_ids || []);
  const [active, setActive] = useState(template?.active !== false);
  const [saving, setSaving] = useState(false);

  // Fetch categories from Odoo
  const [categories, setCategories] = useState<any[]>([]);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [loadingCats, setLoadingCats] = useState(true);

  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch('/api/inventory/products?limit=500');
        const data = await res.json();
        const products = data.products || [];

        // Extract unique categories
        const catMap = new Map<number, { id: number; name: string; count: number }>();
        for (const p of products) {
          if (p.categ_id) {
            const [id, name] = p.categ_id;
            const existing = catMap.get(id);
            if (existing) {
              existing.count++;
            } else {
              catMap.set(id, { id, name, count: 1 });
            }
          }
        }
        const cats = Array.from(catMap.values()).sort((a, b) => b.count - a.count);
        setCategories(cats);
      } catch (err) {
        console.error('Failed to load categories:', err);
      } finally {
        setLoadingCats(false);
      }
    }
    loadCategories();
  }, []);

  // Auto-select first location if none selected
  useEffect(() => {
    if (!locationId && locations.length > 0) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  // Compute product count based on selected categories
  useEffect(() => {
    if (selectedCats.length === 0) {
      // All categories = total products
      const total = categories.reduce((sum, c) => sum + c.count, 0);
      setProductCount(total > 0 ? total : null);
    } else {
      const count = categories
        .filter((c) => selectedCats.includes(c.id))
        .reduce((sum, c) => sum + c.count, 0);
      setProductCount(count);
    }
  }, [selectedCats, categories]);

  function toggleCategory(catId: number) {
    setSelectedCats((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  }

  const isEdit = !!template?.id;
  const canSave = name.trim().length > 0 && locationId !== null;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    await onSave({
      ...(isEdit ? { id: template.id } : {}),
      name: name.trim(),
      frequency,
      location_id: locationId,
      category_ids: selectedCats,
      assign_type: assignType,
      assign_id: assignId,
      active,
    });
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onCancel}
        title={isEdit ? `Edit: ${template.name}` : 'New counting list'}
      />

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-28">
        {/* Name */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">List name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily bar count"
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors" />
        </div>

        {/* Frequency */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Frequency</label>
          <div className="flex gap-2 flex-wrap">
            {FREQUENCIES.map((f) => (
              <button key={f.id} onClick={() => setFrequency(f.id)}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                  frequency === f.id
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
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
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}>
                {loc.complete_name?.split('/')[0] || loc.name}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">
            Categories
            {productCount !== null && (
              <span className="ml-2 text-orange-600 normal-case tracking-normal">
                {selectedCats.length === 0 ? `All products (${productCount})` : `${productCount} products selected`}
              </span>
            )}
          </label>
          {loadingCats ? (
            <div className="py-4"><Spinner /></div>
          ) : (
            <>
              <button onClick={() => setSelectedCats([])}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all mb-2 ${
                  selectedCats.length === 0
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}>
                All categories
              </button>
              <div className="flex gap-2 flex-wrap">
                {categories.map((cat) => (
                  <button key={cat.id} onClick={() => toggleCategory(cat.id)}
                    className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold border transition-all ${
                      selectedCats.includes(cat.id)
                        ? 'bg-orange-50 border-orange-200 text-orange-700'
                        : 'bg-white border-gray-200 text-gray-500'
                    }`}>
                    {cat.name} <span className="text-[11px] opacity-60 ml-0.5 font-mono">{cat.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Assign to */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Assign to</label>
          <div className="flex gap-2 mb-3 flex-wrap">
            <button onClick={() => { setAssignType(null); setAssignId(null); }}
              className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                !assignType ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-500'
              }`}>
              Anyone
            </button>
            {ASSIGN_TYPES.map((at) => (
              <button key={at.id} onClick={() => { setAssignType(at.id); setAssignId(null); }}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center min-w-[70px] ${
                  assignType === at.id ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-500'
                }`}>
                {at.label}
              </button>
            ))}
          </div>

          {/* Department selector */}
          {assignType === 'department' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">All members of this department will see the list</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose department...</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.member_count} members)</option>
                ))}
              </select>
            </div>
          )}

          {/* Person selector */}
          {assignType === 'person' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">Select a specific staff member</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose person...</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Portal users will appear here once employees are linked</p>
            </div>
          )}

          {/* Shift selector */}
          {assignType === 'shift' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">Staff on this shift (from Planning) will see the list</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose shift...</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Planning roles will appear here once configured in Odoo</p>
            </div>
          )}
        </div>

        {/* Active toggle */}
        {isEdit && (
          <div className="mb-5">
            <button onClick={() => setActive(!active)}
              className="flex items-center justify-between w-full bg-white border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-[14px] font-semibold text-gray-900">Active</span>
              <div className={`w-11 h-6 rounded-full relative transition-colors ${active ? 'bg-orange-500' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </div>
            </button>
          </div>
        )}

        {/* Preview summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold tracking-wide uppercase text-gray-400 mb-2">Summary</p>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-semibold text-gray-900">{name || '---'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Frequency</span>
              <span className="font-semibold text-gray-900">{FREQUENCIES.find(f => f.id === frequency)?.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Location</span>
              <span className="font-semibold text-gray-900">
                {locationId ? (locations.find((l: any) => l.id === locationId)?.complete_name?.split('/')[0] || '---') : '---'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Categories</span>
              <span className="font-semibold text-gray-900">
                {selectedCats.length === 0 ? 'All' : `${selectedCats.length} selected`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Products</span>
              <span className="font-semibold font-mono text-orange-600">{productCount ?? '---'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Assign to</span>
              <span className="font-semibold text-gray-900">{assignType || 'Anyone'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
        <button onClick={handleSubmit} disabled={saving || !canSave}
          className="w-full py-4 rounded-xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all disabled:opacity-50">
          {saving ? 'Saving...' : (isEdit ? 'Update counting list' : `Create counting list${productCount ? ` (${productCount} products)` : ''}`)}
        </button>
      </div>
    </div>
  );
}
