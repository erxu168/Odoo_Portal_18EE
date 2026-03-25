'use client';

import React, { useState, useEffect } from 'react';

interface ProductionRecipe {
  id: number;
  product_tmpl_id: [number, string] | false;
  product_qty: number;
  x_recipe_category_id: [number, string] | false;
  x_recipe_difficulty: string | false;
  x_recipe_step_count: number;
  x_cook_time_min: number | false;
  bom_line_ids: number[];
}

interface Category {
  id: number;
  name: string;
  icon: string | false;
  mode: string;
  recipe_count: number;
}

interface Props {
  userRole: string;
  onSelectRecipe: (recipe: ProductionRecipe) => void;
  onBack: () => void;
  onHome: () => void;
}

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  easy:   { bg: 'bg-green-100', text: 'text-green-800', label: 'Easy' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Medium' },
  hard:   { bg: 'bg-red-100',   text: 'text-red-800',   label: 'Hard' },
};

export default function ProductionGuideBrowse({ onSelectRecipe, onBack, onHome }: Props) {
  const [recipes, setRecipes] = useState<ProductionRecipe[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<number | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/recipes?mode=production_guide');
        if (!res.ok) throw new Error('Failed to fetch recipes');
        const data = await res.json();
        setRecipes(data.production_guide || []);
        const prodCats = (data.categories || []).filter(
          (c: Category) => c.mode === 'production_guide' && c.recipe_count > 0
        );
        setCategories(prodCats);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  function getName(r: ProductionRecipe): string {
    return r.product_tmpl_id ? r.product_tmpl_id[1] : `BoM #${r.id}`;
  }

  const filtered = recipes.filter(r => {
    if (search) {
      const s = search.toLowerCase();
      if (!getName(r).toLowerCase().includes(s)) return false;
    }
    if (activeCategory !== null) {
      if (!r.x_recipe_category_id || r.x_recipe_category_id[0] !== activeCategory) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Production Guide</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">WAJ sauces & prep</p>
          </div>
          <button onClick={onHome}
            className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search production recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[14px] text-gray-900 placeholder-gray-400 outline-none bg-transparent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 active:text-gray-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Category filters */}
      {categories.length > 0 && (
        <div className="px-5 pt-3">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-semibold border transition-colors ${
                activeCategory === null
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
              }`}
            >All</button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-semibold border transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                }`}
              >{cat.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Recipe list */}
      <div className="px-5 pt-4 pb-8 flex-1">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-[13px] text-red-800 font-semibold">Failed to load recipes</p>
            <p className="text-[12px] text-red-600 mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">\ud83d\udd0d</div>
            <p className="text-[14px] text-gray-500 font-medium">No recipes found</p>
            <p className="text-[12px] text-gray-400 mt-1">
              {search ? 'Try a different search term' : 'No published recipes in this category'}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {filtered.map(recipe => {
            const diff = recipe.x_recipe_difficulty ? DIFFICULTY_STYLES[recipe.x_recipe_difficulty] : null;
            const catName = recipe.x_recipe_category_id ? recipe.x_recipe_category_id[1] : '';
            const name = getName(recipe);
            const ingredientCount = recipe.bom_line_ids?.length || 0;
            return (
              <button
                key={recipe.id}
                onClick={() => onSelectRecipe(recipe)}
                className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-xl bg-purple-50 flex items-center justify-center text-2xl flex-shrink-0">
                    \ud83c\udfed
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-gray-900 truncate">{name}</div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {catName && (
                        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{catName}</span>
                      )}
                      {diff && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>{diff.label}</span>
                      )}
                      <span className="text-[11px] font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{recipe.product_qty} kg</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 font-mono">
                      <span>{ingredientCount} ingredients</span>
                      <span>{recipe.x_recipe_step_count} steps</span>
                      {recipe.x_cook_time_min ? <span>{recipe.x_cook_time_min} min</span> : null}
                      {recipe.x_recipe_step_count === 0 && (
                        <span className="text-amber-600 font-sans font-semibold">No guide yet</span>
                      )}
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2" className="flex-shrink-0 mt-1">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer count */}
      {!loading && !error && (
        <div className="text-center py-4 border-t border-gray-100">
          <span className="text-[11px] text-gray-400">
            {filtered.length} recipe{filtered.length !== 1 ? 's' : ''}
            {activeCategory !== null ? ' in category' : ''}
            {search ? ` matching \"${search}\"` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
