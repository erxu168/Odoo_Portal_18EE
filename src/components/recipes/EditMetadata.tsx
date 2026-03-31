'use client';

import React, { useState, useEffect } from 'react';

interface Category {
  id: number;
  name: string;
  mode: string;
}

interface Props {
  mode: 'cooking' | 'production';
  recipeName: string;
  difficulty: string;
  categoryId: number | null;
  productQty: number;
  submitting?: boolean;
  onSave: (metadata: { name: string; difficulty: string; categoryId: number | null; productQty: number }) => void;
  onBack: () => void;
  onHome?: () => void;
}

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy', emoji: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>, bg: 'bg-green-100 border-green-300 text-green-800', activeBg: 'bg-green-600 border-green-600 text-white' },
  { value: 'medium', label: 'Medium', emoji: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 00-8 0v2"/></svg>, bg: 'bg-amber-100 border-amber-300 text-amber-800', activeBg: 'bg-amber-600 border-amber-600 text-white' },
  { value: 'hard', label: 'Hard', emoji: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1012 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>, bg: 'bg-red-100 border-red-300 text-red-800', activeBg: 'bg-red-600 border-red-600 text-white' },
];

const MODE_STYLES = {
  cooking: {
    filterActive: 'bg-green-600 text-white border-green-600',
    spinner: 'border-green-600',
    saveBtn: 'bg-green-600 active:bg-green-700 shadow-lg',
  },
  production: {
    filterActive: 'bg-blue-600 text-white border-purple-600',
    spinner: 'border-purple-600',
    saveBtn: 'bg-blue-600 active:bg-blue-700 shadow-lg',
  },
};

export default function EditMetadata({
  mode, recipeName, difficulty, categoryId, productQty,
  submitting, onSave, onBack, onHome,
}: Props) {
  const [name, setName] = useState(recipeName);
  const [diff, setDiff] = useState(difficulty);
  const [catId, setCatId] = useState<number | null>(categoryId);
  const [qty, setQty] = useState(productQty || (mode === 'production' ? 10 : 1));
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const styles = MODE_STYLES[mode];

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/recipes/categories');
        if (res.ok) {
          const data = await res.json();
          const filtered = ((data?.categories) || []).filter(
            (c: Category) => c.mode === (mode === 'cooking' ? 'cooking_guide' : 'production_guide')
          );
          setCategories(filtered);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    fetchCategories();
  }, [mode]);

  const hasChanges = name.trim() !== recipeName || diff !== difficulty || catId !== categoryId || (mode === 'production' && qty !== productQty);
  const canSave = name.trim().length >= 2 && hasChanges && !submitting;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Edit Details</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">{recipeName}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 flex-1">
        {/* Name */}
        <div className="mb-6">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Recipe name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Bulgogi"
            className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl text-[15px] text-gray-900 placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <div className="text-[11px] text-gray-400 mt-1 text-right">{name.length}/100</div>
        </div>

        {/* Category */}
        <div className="mb-6">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Category</label>
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <div className={`w-6 h-6 border-2 ${styles.spinner} border-t-transparent rounded-full animate-spin`} />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCatId(null)}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  catId === null
                    ? styles.filterActive
                    : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                }`}
              >None</button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCatId(catId === cat.id ? null : cat.id)}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                    catId === cat.id
                      ? styles.filterActive
                      : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                  }`}
                >{cat.name}</button>
              ))}
            </div>
          )}
        </div>

        {/* Difficulty */}
        <div className="mb-6">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Difficulty</label>
          <div className="flex gap-2">
            {DIFFICULTIES.map(d => (
              <button
                key={d.value}
                onClick={() => setDiff(diff === d.value ? '' : d.value)}
                className={`flex-1 py-3 rounded-xl text-[13px] font-semibold border transition-colors flex items-center justify-center gap-1.5 ${
                  diff === d.value ? d.activeBg : d.bg
                }`}
              >
                <span>{d.emoji}</span> {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quantity (production only) */}
        {mode === 'production' && (
          <div className="mb-6">
            <label className="text-[13px] font-bold text-gray-900 mb-2 block">Base quantity (kg)</label>
            <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-4 py-3">
              <button
                onClick={() => setQty(Math.max(1, qty - 5))}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-200"
              >-</button>
              <div className="flex-1 text-center">
                <span className="text-[24px] font-bold text-gray-900 font-mono">{qty}</span>
                <span className="text-[14px] text-gray-400 ml-1">kg</span>
              </div>
              <button
                onClick={() => setQty(qty + 5)}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-200"
              >+</button>
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom button */}
      <div className="px-5 py-4">
        <button
          onClick={() => onSave({ name: name.trim(), difficulty: diff, categoryId: catId, productQty: qty })}
          disabled={!canSave}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            canSave ? styles.saveBtn : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
