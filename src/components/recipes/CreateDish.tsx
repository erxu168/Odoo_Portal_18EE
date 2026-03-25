'use client';

import React, { useState, useEffect } from 'react';

interface Category {
  id: number;
  name: string;
  mode: string;
}

interface Props {
  mode: 'cooking' | 'production';
  onBack: () => void;
  onHome: () => void;
  onCreated: (dish: { name: string; categoryId: number | null; baseServings: number; mode: string; odooId: number }) => void;
}

export default function CreateDish({ mode, onBack, onHome, onCreated }: Props) {
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [baseServings, setBaseServings] = useState(mode === 'cooking' ? 1 : 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/recipes/categories')
      .then(r => r.json())
      .then(data => {
        const modeStr = mode === 'cooking' ? 'cooking_guide' : 'production_guide';
        setCategories((data.categories || []).filter((c: Category) => c.mode === modeStr));
      })
      .catch(() => {});
  }, [mode]);

  const unit = mode === 'cooking' ? 'servings' : 'kg';
  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-purple-600';
  const canSave = name.trim().length >= 2;

  async function handleCreate() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/recipes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category_id: selectedCat,
          base_servings: baseServings,
          mode: mode === 'cooking' ? 'cooking_guide' : 'production_guide',
        }),
      });
      const data = await res.json();
      if (res.ok && data.odoo_id) {
        onCreated({
          name: name.trim(),
          categoryId: selectedCat,
          baseServings,
          mode: mode === 'cooking' ? 'cooking_guide' : 'production_guide',
          odooId: data.odoo_id,
        });
      } else {
        setError(data.error || 'Failed to create dish. Please try again.');
      }
    } catch (_e) { setError('Connection failed. Please check your network and try again.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Create New Dish</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">{mode === 'cooking' ? 'Cooking Guide' : 'Production Guide'}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-5 pb-32 flex-1">
        <div className="mb-5">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Dish name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kimchi Jjigae" maxLength={100}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[15px] text-gray-900 placeholder-gray-400 bg-white" />
        </div>
        <div className="mb-5">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Category</label>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCat(selectedCat === cat.id ? null : cat.id)}
                className={`px-4 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
                  selectedCat === cat.id ? `${accentBg} text-white border-transparent` : 'bg-white text-gray-600 border-gray-200'
                }`}>{cat.name}</button>
            ))}
          </div>
        </div>
        <div className="mb-5">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Base {unit}</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setBaseServings(Math.max(1, baseServings - (mode === 'cooking' ? 1 : 5)))}
              className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-100">-</button>
            <div className="w-20 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[22px] font-bold text-gray-900 font-mono">{baseServings}</div>
            <button onClick={() => setBaseServings(baseServings + (mode === 'cooking' ? 1 : 5))}
              className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-100">+</button>
            <span className="text-[14px] text-gray-500 font-medium">{unit}</span>
          </div>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-800">
            {error}
          </div>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto space-y-2">
        <button onClick={handleCreate} disabled={!canSave || saving}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            canSave ? `${accentBg} shadow-lg` : 'bg-gray-300 cursor-not-allowed'
          }`}>
          {saving ? 'Creating...' : 'Create and start recording'}
        </button>
      </div>
    </div>
  );
}
