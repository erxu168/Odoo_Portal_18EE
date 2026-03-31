'use client';

import React, { useState, useRef } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface CreateBomProps {
  onBack: () => void;
  onCreated: (bomId: number) => void;
}

interface NewLine {
  id: number; // negative temp ID
  product_id: number;
  product_name: string;
  product_qty: number;
  uom_id: number;
  uom_name: string;
}

export default function CreateBom({ onBack, onCreated }: CreateBomProps) {
  // Product search for the main product
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BOM config
  const [bomQty, setBomQty] = useState('10');
  const [lines, setLines] = useState<NewLine[]>([]);

  // Add ingredient search
  const [showIngSearch, setShowIngSearch] = useState(false);
  const [ingSearch, setIngSearch] = useState('');
  const [ingResults, setIngResults] = useState<any[]>([]);
  const [ingSearching, setIngSearching] = useState(false);
  const ingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submit
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function searchProducts(q: string) {
    setProductSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setProductResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=15`);
        const data = await res.json();
        setProductResults(data.products || []);
      } catch (_e) { setProductResults([]); }
      finally { setSearching(false); }
    }, 300);
  }

  function selectProduct(p: any) {
    setSelectedProduct(p);
    setProductSearch('');
    setProductResults([]);
  }

  function searchIngredients(q: string) {
    setIngSearch(q);
    if (ingTimer.current) clearTimeout(ingTimer.current);
    if (q.length < 2) { setIngResults([]); return; }
    ingTimer.current = setTimeout(async () => {
      setIngSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=15`);
        const data = await res.json();
        setIngResults(data.products || []);
      } catch (_e) { setIngResults([]); }
      finally { setIngSearching(false); }
    }, 300);
  }

  function addIngredient(p: any) {
    if (lines.some(l => l.product_id === p.id)) return;
    setLines(prev => [...prev, {
      id: -(Date.now()),
      product_id: p.id,
      product_name: p.name,
      product_qty: 1,
      uom_id: p.uom_id,
      uom_name: p.uom_name,
    }]);
    setShowIngSearch(false);
    setIngSearch('');
    setIngResults([]);
  }

  function updateLineQty(id: number, val: string) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, product_qty: parseFloat(val) || 0 } : l));
  }

  function removeLine(id: number) {
    setLines(prev => prev.filter(l => l.id !== id));
  }

  async function handleSave() {
    if (!selectedProduct || !bomQty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/boms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_tmpl_id: selectedProduct.id,
          product_qty: parseFloat(bomQty) || 1,
          product_uom_id: selectedProduct.uom_id,
          lines: lines.map(l => ({
            product_id: l.product_id,
            product_qty: l.product_qty,
            product_uom_id: l.uom_id,
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to create recipe');
      onCreated(data.id);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to create recipe');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="New Recipe" subtitle="Create a bill of materials" showBack onBack={onBack} />

      <div className="px-4 pt-4 pb-8">
        {/* Step 1: Select output product */}
        <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">Output product</label>
        {selectedProduct ? (
          <div className="bg-white border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
            <div>
              <div className="text-[var(--fs-md)] font-bold text-gray-900">{selectedProduct.name}</div>
              <div className="text-[var(--fs-xs)] text-gray-400">{selectedProduct.uom_name}</div>
            </div>
            <button onClick={() => setSelectedProduct(null)} className="text-[var(--fs-xs)] text-gray-400 font-semibold active:text-red-500">Change</button>
          </div>
        ) : (
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={e => searchProducts(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-sm)] outline-none focus:border-green-600"
            />
            {searching && <div className="text-center py-3"><div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" /></div>}
            {productResults.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl mt-1 max-h-48 overflow-y-auto">
                {productResults.map(p => (
                  <button key={p.id} onClick={() => selectProduct(p)}
                    className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 active:bg-green-50">
                    <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400">{p.uom_name} {p.category !== 'Other' ? `\u00b7 ${p.category}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Output quantity */}
        {selectedProduct && (
          <>
            <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">Output quantity ({selectedProduct.uom_name})</label>
            <input
              type="number"
              inputMode="decimal"
              value={bomQty}
              onChange={e => setBomQty(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-xxl)] font-bold text-gray-900 outline-none focus:border-green-600 mb-4"
            />

            {/* Step 3: Ingredients */}
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
              Ingredients ({lines.length})
            </div>

            <div className="flex flex-col gap-2 mb-4">
              {lines.map(line => (
                <div key={line.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{line.product_name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400">{line.uom_name}</div>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={line.product_qty || ''}
                    onChange={e => updateLineQty(line.id, e.target.value)}
                    className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[var(--fs-md)] font-bold font-mono text-right text-gray-900 outline-none focus:border-green-600"
                  />
                  <button onClick={() => removeLine(line.id)}
                    className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center active:bg-red-100 flex-shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-500">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add ingredient */}
            {showIngSearch ? (
              <div className="bg-white border border-green-200 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={ingSearch}
                    onChange={e => searchIngredients(e.target.value)}
                    autoFocus
                    className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600"
                  />
                  <button onClick={() => { setShowIngSearch(false); setIngSearch(''); setIngResults([]); }}
                    className="text-[var(--fs-xs)] font-semibold text-gray-500 px-2">Cancel</button>
                </div>
                {ingSearching && <div className="text-center py-3"><div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" /></div>}
                {ingResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto">
                    {ingResults.map(p => {
                      const added = lines.some(l => l.product_id === p.id);
                      return (
                        <button key={p.id} onClick={() => !added && addIngredient(p)} disabled={added}
                          className="w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-0 active:bg-green-50 disabled:opacity-40">
                          <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{p.name}</div>
                          <div className="text-[var(--fs-xs)] text-gray-400">{p.uom_name} {added ? '(added)' : ''}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => setShowIngSearch(true)}
                className="w-full py-3 rounded-xl border-[1.5px] border-dashed border-gray-300 text-[var(--fs-sm)] font-semibold text-gray-500 flex items-center justify-center gap-2 active:bg-gray-50 mb-4">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add ingredient
              </button>
            )}

            {saveError && (
              <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-xs)]">{saveError}</div>
            )}

            {/* Save button */}
            <button onClick={handleSave} disabled={saving || !selectedProduct || lines.length === 0}
              className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
              {saving ? 'Creating...' : `Create recipe (${lines.length} ingredients)`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
