'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface IngRow { pivot_id: number; name: string; qty: number; uom: string; }
interface ProductResult { id: number; name: string; uom_id: number | null; uom_name: string }

interface Props {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  onBack: () => void;
}

export default function EditIngredients({ mode, recipeId, recipeName, onBack }: Props) {
  const [rows, setRows] = useState<IngRow[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [firstStepId, setFirstStepId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Add-ingredient search
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const param = mode === 'cooking' ? `product_tmpl_id=${recipeId}` : `bom_id=${recipeId}`;
        const res = await fetch(`/api/recipes/steps?${param}`);
        if (res.ok) {
          const data = await res.json();
          const steps = data.steps || [];
          setFirstStepId(steps[0]?.id ?? null);
          const map = new Map<number, IngRow>();
          for (const s of steps) {
            for (const ing of (s.ingredients || [])) {
              if (ing.pivot_id && !map.has(ing.pivot_id)) {
                map.set(ing.pivot_id, { pivot_id: ing.pivot_id, name: ing.name, qty: ing.qty || 0, uom: ing.uom || '' });
              }
            }
          }
          const list = Array.from(map.values());
          setRows(list);
          const vals: Record<number, string> = {};
          list.forEach(r => { vals[r.pivot_id] = String(r.qty); });
          setValues(vals);
        }
      } catch { /* offline */ } finally { setLoading(false); }
    }
    load();
  }, [recipeId, mode]);

  function searchProducts(q: string) {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 1) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}&limit=10`);
        if (res.ok) { const data = await res.json(); setResults(data.products || []); }
      } catch { /* */ } finally { setSearching(false); }
    }, 300);
  }

  async function addProduct(p: ProductResult) {
    if (!firstStepId) { setToast('Add a step to the recipe first'); return; }
    if (rows.some(r => r.name === p.name)) { setToast(`${p.name} is already in the recipe`); return; }
    setAdding(true);
    try {
      const res = await fetch('/api/recipes/ingredients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_id: firstStepId, product_id: p.id, qty: 0, uom_id: p.uom_id }),
      });
      const data = await res.json();
      if (res.ok && data.pivot_id) {
        const row: IngRow = { pivot_id: data.pivot_id, name: p.name, qty: 0, uom: p.uom_name || '' };
        setRows(prev => [...prev, row]);
        setValues(v => ({ ...v, [row.pivot_id]: '0' }));
        setQuery(''); setResults([]); setShowAdd(false);
        setToast(`${p.name} added — set its amount`);
      } else { setToast(data.error || 'Could not add'); }
    } catch { setToast('Connection failed'); } finally { setAdding(false); }
  }

  async function removeRow(pivotId: number) {
    try {
      const res = await fetch('/api/recipes/ingredients', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pivot_id: pivotId }),
      });
      if (res.ok) {
        setRows(prev => prev.filter(r => r.pivot_id !== pivotId));
        setValues(v => { const n = { ...v }; delete n[pivotId]; return n; });
      } else { setToast('Could not remove'); }
    } catch { setToast('Connection failed'); }
  }

  async function save() {
    setSaving(true);
    try {
      const updates = rows.map(r => ({ pivot_id: r.pivot_id, qty: parseFloat(values[r.pivot_id]) || 0 }));
      const res = await fetch('/api/recipes/ingredients', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }),
      });
      if (res.ok) { setToast('Amounts saved'); setTimeout(onBack, 900); }
      else { const e = await res.json(); setToast(e.error || 'Save failed'); }
    } catch { setToast('Connection failed'); } finally { setSaving(false); }
  }

  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-blue-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-blue-700';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Ingredients" subtitle={recipeName} showBack onBack={onBack} />
      <div className="px-5 pt-4 pb-32 flex-1">
        {loading && (
          <div className="text-center py-12"><div className="w-8 h-8 border-[3px] border-green-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        )}

        {!loading && (
          <>
            <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">Set the amount for one batch, add or remove ingredients. Amounts scale automatically when a cook chooses a batch size.</p>

            <div className="flex flex-col gap-2">
              {rows.map(r => (
                <div key={r.pivot_id} className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0 text-[14px] font-semibold text-gray-800 truncate">{r.name}</div>
                  <input type="number" inputMode="decimal" value={values[r.pivot_id] ?? ''}
                    onChange={(e) => setValues(v => ({ ...v, [r.pivot_id]: e.target.value }))}
                    className="w-20 px-3 py-2 rounded-lg border border-gray-200 text-[15px] font-mono font-semibold text-right text-gray-900 focus:border-green-500 focus:outline-none" />
                  <div className="w-7 text-[12px] text-gray-400 font-mono">{r.uom}</div>
                  <button onClick={() => removeRow(r.pivot_id)} aria-label="Remove"
                    className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 active:bg-red-100">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add ingredient */}
            {!showAdd ? (
              <button onClick={() => setShowAdd(true)}
                className="mt-3 w-full py-3 rounded-xl border border-dashed border-gray-300 text-[14px] font-semibold text-gray-600 active:bg-gray-100 flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                Add ingredient
              </button>
            ) : (
              <div className="mt-3 bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input autoFocus type="text" value={query} onChange={(e) => searchProducts(e.target.value)}
                    placeholder="Search ingredient…" maxLength={100}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-[14px] focus:border-green-500 focus:outline-none" />
                  <button onClick={() => { setShowAdd(false); setQuery(''); setResults([]); }}
                    className="text-[13px] font-semibold text-gray-500 px-2">Cancel</button>
                </div>
                {searching && <div className="text-[12px] text-gray-400 py-1">Searching…</div>}
                {results.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                    {results.map(p => {
                      const already = rows.some(r => r.name === p.name);
                      return (
                        <button key={p.id} onClick={() => !already && !adding && addProduct(p)} disabled={already || adding}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left ${already ? 'opacity-40' : 'active:bg-gray-100'}`}>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-gray-800 truncate">{p.name}</div>
                            <div className="text-[11px] text-gray-400">{p.uom_name}{already ? ' · already added' : ''}</div>
                          </div>
                          {!already && <div className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></div>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {query.length > 0 && !searching && results.length === 0 && (
                  <div className="text-[12px] text-gray-400 py-1">No products found</div>
                )}
              </div>
            )}

            {rows.length === 0 && !showAdd && (
              <div className="text-center py-6 text-[13px] text-gray-400">No ingredients yet — tap &ldquo;Add ingredient.&rdquo;</div>
            )}
          </>
        )}
      </div>
      {!loading && (
        <div className="px-5 py-4">
          <button onClick={save} disabled={saving}
            className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white shadow-lg ${accentBg} ${accentActive} disabled:opacity-50`}>
            {saving ? 'Saving…' : 'Save amounts'}
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[13px] px-4 py-2 rounded-full shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
