'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

interface UnitOption { id: number; name: string }
interface CategoryOption { id: number; name: string }

/**
 * The ONE product quick-create sheet, shared by every module (single-canonical-
 * form rule). It is purely presentational — the parent owns saving/error and the
 * onCreate handler (so purchase posts to its guide endpoint, inventory to its
 * own), and `context` only tunes the copy, accent, and which extra fields show.
 *  - 'purchase'  → price + supplier code + par level, "Create & add to guide"
 *  - 'inventory' → name/unit/category only,          "Create & add to list"
 *
 * When `canCreateCategory` is set, the Category select also offers an in-place
 * "+ New category" (no dead-end picker) — gated by the caller because creating a
 * product.category requires the inventory.productsettings.manage capability.
 */
interface CreateProductSheetProps {
  open: boolean;
  initialName: string;
  units: UnitOption[];
  categories: CategoryOption[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onCreate: (payload: { name: string; uom_id: number; price: number; categ_id: number; default_code: string; par_level: number }) => void;
  context?: 'purchase' | 'inventory';
  /** Stacking base so it always sits above the picker that opened it. */
  baseZ?: number;
  /** Show the in-place "+ New category" affordance (permission-gated by caller). */
  canCreateCategory?: boolean;
}

export default function CreateProductSheet({
  open, initialName, units, categories, saving, error, onClose, onCreate,
  context = 'purchase', baseZ = 110, canCreateCategory = false,
}: CreateProductSheetProps) {
  const [name, setName] = useState('');
  const [uomId, setUomId] = useState<number>(0);
  const [priceStr, setPriceStr] = useState('');
  const [categId, setCategId] = useState<number>(0);
  const [productCode, setProductCode] = useState('');
  const [parLevelStr, setParLevelStr] = useState('');
  // In-place category create (categories created here persist across prop
  // refreshes via createdCats, so a fresh `categories` prop can't drop them).
  const [createdCats, setCreatedCats] = useState<CategoryOption[]>([]);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catErr, setCatErr] = useState('');

  const isPurchase = context === 'purchase';
  const inputCls = `w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] text-gray-900 outline-none ${isPurchase ? 'focus:border-[#F5800A]' : 'focus:border-green-500'}`;
  const btnCls = isPurchase ? 'bg-[#F5800A] active:bg-[#E86000]' : 'bg-green-600 active:bg-green-700';
  const submitLabel = isPurchase ? 'Create & add to guide' : 'Create & add to list';
  const footnote = isPurchase
    ? 'Creates the product in Odoo (marked orderable) and adds it here.'
    : 'Creates the product in Odoo and adds it to this list.';

  const allCats = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...createdCats.filter((c) => !seen.has(c.id))];
  }, [categories, createdCats]);

  // Reset the form ONLY when the sheet transitions to open — a later
  // units/categories refetch must NOT wipe a just-created category or the
  // fields the user is editing. `sessionRef` bumps each open so an in-flight
  // category POST from a previous session can't mutate this one.
  const sessionRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    setName(initialName);
    setUomId(units[0]?.id || 0);
    setCategId(categories[0]?.id || 0);
    setPriceStr('');
    setProductCode('');
    setParLevelStr('');
    setCreatedCats([]);
    setNewCatOpen(false);
    setNewCatName('');
    setCatErr('');
    setCatBusy(false);   // a prior session's in-flight POST won't clear this (session-guarded), so reset it here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // If unit/category options arrive AFTER opening, fill the still-empty defaults
  // without clobbering a user's choice or a just-created category.
  useEffect(() => { if (open && uomId === 0 && units[0]) setUomId(units[0].id); }, [open, units, uomId]);
  useEffect(() => {
    if (open && categId === 0 && !newCatOpen && createdCats.length === 0 && categories[0]) setCategId(categories[0].id);
  }, [open, categories, categId, newCatOpen, createdCats.length]);

  async function createCategory() {
    const nm = newCatName.trim();
    if (!nm) return;
    const mySession = sessionRef.current;
    setCatBusy(true);
    setCatErr('');
    try {
      const res = await fetch('/api/inventory/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm }),
      });
      const d = await res.json().catch(() => ({}));
      if (sessionRef.current !== mySession) return;   // sheet was closed/reopened — drop this result
      if (!res.ok || !d.category?.id) { setCatErr(d.error || 'Could not create category'); return; }
      const cat = { id: d.category.id, name: d.category.complete_name || d.category.name || nm };
      setCreatedCats((prev) => [cat, ...prev]);
      setCategId(cat.id);
      setNewCatOpen(false);
      setNewCatName('');
    } catch { if (sessionRef.current === mySession) setCatErr('Network error — category not created'); }
    finally { if (sessionRef.current === mySession) setCatBusy(false); }
  }

  if (!open) return null;

  // Block the main submit while a category is being created/typed, else the
  // product would save under the PREVIOUS category.
  const canSubmit = name.trim().length > 0 && uomId > 0 && !saving && !catBusy && !newCatOpen;

  return (
    <div className="fixed inset-0 flex items-end justify-center bg-black/40" style={{ zIndex: baseZ }} onClick={onClose}>
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
          className={`${inputCls} mb-3`}
        />

        <div className="flex gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Unit</label>
            <select value={uomId} onChange={(e) => setUomId(Number(e.target.value))} className={inputCls}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          {isPurchase && (
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Price (€)</label>
              <input value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
            </div>
          )}
        </div>

        <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Category</label>
        <select
          value={newCatOpen ? -1 : categId}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v === -1) { setNewCatOpen(true); setNewCatName(''); setCatErr(''); return; }
            setNewCatOpen(false);
            setCategId(v);
          }}
          className={`${inputCls} ${newCatOpen ? 'mb-2' : 'mb-4'}`}
        >
          {categId !== 0 && !allCats.some((c) => c.id === categId) && <option value={categId}>Current category</option>}
          {allCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          {canCreateCategory && <option value={-1}>+ New category…</option>}
        </select>
        {newCatOpen && (
          <div className="mb-4">
            <div className="flex gap-2">
              <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); if (e.key === 'Escape') { setNewCatOpen(false); setNewCatName(''); } }}
                placeholder="New category name" disabled={catBusy} className={inputCls} />
              <button onClick={createCategory} disabled={catBusy || !newCatName.trim()}
                className="px-4 rounded-lg bg-green-600 text-white font-bold text-[var(--fs-sm)] disabled:opacity-40 whitespace-nowrap">{catBusy ? 'Adding…' : 'Add'}</button>
              <button onClick={() => { setNewCatOpen(false); setNewCatName(''); setCatErr(''); }} disabled={catBusy}
                className="px-4 rounded-lg bg-gray-100 font-bold text-[var(--fs-sm)]">Cancel</button>
            </div>
            {catErr && <p className="text-[11px] text-red-600 mt-1">{catErr}</p>}
          </div>
        )}

        {isPurchase && (
          <div className="flex gap-2 mb-4">
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Product code <span className="normal-case font-normal">(supplier)</span></label>
              <input value={productCode} onChange={(e) => setProductCode(e.target.value)} placeholder="e.g. ART-1234" className={inputCls} />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5">Par level <span className="normal-case font-normal">(target)</span></label>
              <input value={parLevelStr} onChange={(e) => setParLevelStr(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
            </div>
          </div>
        )}

        <button
          onClick={() => onCreate({ name: name.trim(), uom_id: uomId, price: parseFloat(priceStr) || 0, categ_id: categId, default_code: productCode.trim(), par_level: parseFloat(parLevelStr) || 0 })}
          disabled={!canSubmit}
          className={`w-full py-3.5 rounded-xl text-white text-[var(--fs-base)] font-bold ${btnCls} disabled:opacity-50`}
        >
          {saving ? 'Creating…' : submitLabel}
        </button>
        <p className="text-[11px] text-gray-400 text-center mt-2">{footnote}</p>
      </div>
    </div>
  );
}
