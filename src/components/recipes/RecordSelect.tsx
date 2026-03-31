'use client';

import React, { useState, useEffect } from 'react';

interface Recipe {
  id: number;
  name: string;
  mode: string;
  x_recipe_category_id: [number, string] | false;
  x_recipe_step_count: number;
}

interface Props {
  userRole: string;
  onSelectRecipe: (recipe: Recipe, mode: 'cooking' | 'production') => void;
  onCreateNew: (mode: 'cooking' | 'production') => void;
  onBack: () => void;
  onHome?: () => void;
}

export default function RecordSelect({ onSelectRecipe, onCreateNew, onBack, onHome }: Props) {
  const [mode, setMode] = useState<'cooking' | 'production'>('cooking');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const modeParam = mode === 'cooking' ? 'cooking_guide' : 'production_guide';
        const res = await fetch(`/api/recipes?mode=${modeParam}`);
        if (res.ok) {
          const data = await res.json();
          const items = mode === 'cooking'
            ? (data.cooking_guide || []).map((r: any) => ({ ...r, mode: 'cooking' }))
            : (data.production_guide || []).map((r: any) => ({
                id: r.id,
                name: r.product_tmpl_id ? r.product_tmpl_id[1] : `BoM #${r.id}`,
                mode: 'production',
                x_recipe_category_id: r.x_recipe_category_id,
                x_recipe_step_count: r.x_recipe_step_count,
              }));
          setRecipes(items);
        }
      } catch (e) { console.error('Load error:', e); }
      finally { setLoading(false); }
    }
    load();
  }, [mode]);

  const filtered = recipes.filter(r => {
    if (!search) return true;
    return r.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Record Guide</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">Cook + capture</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pt-4">
        <div className="flex bg-gray-200 rounded-xl p-1">
          <button onClick={() => setMode('cooking')}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${mode === 'cooking' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>
            Cooking Guide
          </button>
          <button onClick={() => setMode('production')}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${mode === 'production' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>
            Production Guide
          </button>
        </div>
      </div>

      <div className="px-5 pt-3">
        <div className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input type="text" placeholder="Search recipes..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[14px] text-gray-900 placeholder-gray-400 outline-none bg-transparent" />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-4">
        <button onClick={() => onCreateNew(mode)}
          className="w-full p-4 rounded-2xl border-2 border-dashed border-gray-300 bg-white text-center active:bg-gray-50">
          <div className="text-2xl mb-1">+</div>
          <div className="text-[14px] font-bold text-gray-800">Create new dish</div>
          <div className="text-[12px] text-gray-500 mt-0.5">Add a recipe not yet in the system</div>
        </button>
      </div>

      <div className="px-5 pt-4 pb-8 flex-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          {filtered.map(recipe => {
            const cat = recipe.x_recipe_category_id;
            const hasSteps = recipe.x_recipe_step_count > 0;
            return (
              <button key={recipe.id} onClick={() => onSelectRecipe(recipe, mode)}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-gray-200 rounded-xl text-left active:scale-[0.98] transition-transform">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${mode === 'cooking' ? 'bg-orange-50' : 'bg-blue-50'}`}>
                  {mode === 'cooking' ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-gray-800 truncate">{recipe.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {cat && <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{cat[1]}</span>}
                    {hasSteps
                      ? <span className="text-[11px] text-green-600 font-semibold">{recipe.x_recipe_step_count} steps</span>
                      : <span className="text-[11px] text-amber-600 font-semibold">No guide yet</span>
                    }
                  </div>
                </div>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasSteps ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}>
                  {hasSteps ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
