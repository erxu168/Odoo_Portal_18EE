'use client';

import React, { useEffect, useState } from 'react';

interface UnitOption { id: number; name: string }
interface CategoryOption { id: number; name: string }

interface CreateProductSheetProps {
  open: boolean;
  initialName: string;
  units: UnitOption[];
  categories: CategoryOption[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onCreate: (payload: { name: string; uom_id: number; price: number; categ_id: number; default_code: string; par_level: number }) => void;
}

export default function CreateProductSheet({
  open, initialName, units, categories, saving, error, onClose, onCreate,
}: CreateProductSheetProps) {
  const [name, setName] = useState('');
  const [uomId, setUomId] = useState<number>(0);
  const [priceStr, setPriceStr] = useState('');
  const [categId, setCategId] = useState<number>(0);
  const [productCode, setProductCode] = useState('');
  const [parLevelStr, setParLevelStr] = useState('');

  // Reset the form each time the sheet opens (prefill the name from the search box).
  useEffect(() => {
    if (open) {
      setName(initialName);
      setUomId(units[0]?.id || 0);
      setCategId(categories[0]?.id || 0);
      setPriceStr('');
      setProductCode('');
      setParLevelStr('');
    }
  }, [open, initialName, units, categories]);

  if (!open) return null;

  const canSubmit = name.trim().length > 0 && uomId > 0 && !saving;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-t-2xl max-h-[90vh] overflow-y-auto p-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[var(--fs-lg)] font-bold text-gray-900">New product</h3>
          <button onClick={onClose} className="text-gray-400 text-[22px] leading-none px-2" aria-label="Close">×</button>
        </div>

        {error && (
          <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Product name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chicken wings, marinated"
          autoFocus
          className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A] mb-3"
        />

        <div className="flex gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Unit</label>
            <select
              value={uomId}
              onChange={(e) => setUomId(Number(e.target.value))}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A]"
            >
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Price (€)</label>
            <input
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A]"
            />
          </div>
        </div>

        <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Category</label>
        <select
          value={categId}
          onChange={(e) => setCategId(Number(e.target.value))}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A] mb-4"
        >
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Product code <span className="normal-case font-normal">(supplier)</span></label>
            <input
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. ART-1234"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A]"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Par level <span className="normal-case font-normal">(target)</span></label>
            <input
              value={parLevelStr}
              onChange={(e) => setParLevelStr(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none focus:border-[#F5800A]"
            />
          </div>
        </div>

        <button
          onClick={() => onCreate({ name: name.trim(), uom_id: uomId, price: parseFloat(priceStr) || 0, categ_id: categId, default_code: productCode.trim(), par_level: parseFloat(parLevelStr) || 0 })}
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-xl bg-[#F5800A] text-white text-[var(--fs-base)] font-bold active:bg-[#E86000] disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create & add to guide'}
        </button>
        <p className="text-[11px] text-gray-400 text-center mt-2">Creates the product in Odoo (marked orderable) and adds it here.</p>
      </div>
    </div>
  );
}
