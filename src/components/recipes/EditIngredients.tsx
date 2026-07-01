'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface IngRow { pivot_id: number; name: string; qty: number; uom: string; }

interface Props {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  onBack: () => void;
}

export default function EditIngredients({ mode, recipeId, recipeName, onBack }: Props) {
  const [rows, setRows] = useState<IngRow[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const param = mode === 'cooking' ? `product_tmpl_id=${recipeId}` : `bom_id=${recipeId}`;
        const res = await fetch(`/api/recipes/steps?${param}`);
        if (res.ok) {
          const data = await res.json();
          const map = new Map<number, IngRow>();
          for (const s of (data.steps || [])) {
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
      <AppHeader title="Edit Amounts" subtitle={recipeName} showBack onBack={onBack} />
      <div className="px-5 pt-4 pb-32 flex-1">
        {loading && (
          <div className="text-center py-12"><div className="w-8 h-8 border-[3px] border-green-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        )}
        {!loading && rows.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
            <p className="text-[14px] font-semibold text-amber-900">No ingredients to edit</p>
            <p className="text-[12px] text-amber-700 mt-1">This recipe has no ingredient list yet.</p>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <>
            <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">Set the amount for one batch. These scale automatically when a cook chooses a batch size or uses &ldquo;set by ingredient.&rdquo;</p>
            <div className="flex flex-col gap-2">
              {rows.map(r => (
                <div key={r.pivot_id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0 text-[14px] font-semibold text-gray-800 truncate">{r.name}</div>
                  <input type="number" inputMode="decimal" value={values[r.pivot_id] ?? ''}
                    onChange={(e) => setValues(v => ({ ...v, [r.pivot_id]: e.target.value }))}
                    className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[15px] font-mono font-semibold text-right text-gray-900 focus:border-green-500 focus:outline-none" />
                  <div className="w-8 text-[12px] text-gray-400 font-mono">{r.uom}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {!loading && rows.length > 0 && (
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
