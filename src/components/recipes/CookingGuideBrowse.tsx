'use client';

import React, { useState, useEffect } from 'react';

interface Recipe {
  id: number;
  name: string;
  x_recipe_category_id: [number, string] | false;
  x_recipe_difficulty: string | false;
  x_recipe_step_count: number;
  image_128: string | false;
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
  onSelectRecipe: (recipe: Recipe) => void;
  onBack: () => void;
  onHome?: () => void;
}

const CAT_COLORS = [
  { bg: 'bg-red-500', ring: 'ring-red-200' },
  { bg: 'bg-amber-500', ring: 'ring-amber-200' },
  { bg: 'bg-green-600', ring: 'ring-green-200' },
  { bg: 'bg-blue-500', ring: 'ring-blue-200' },
  { bg: 'bg-blue-500', ring: 'ring-purple-200' },
  { bg: 'bg-pink-500', ring: 'ring-pink-200' },
  { bg: 'bg-teal-500', ring: 'ring-teal-200' },
  { bg: 'bg-orange-500', ring: 'ring-orange-200' },
  { bg: 'bg-indigo-500', ring: 'ring-indigo-200' },
  { bg: 'bg-cyan-600', ring: 'ring-cyan-200' },
];

const CAT_FALLBACK_ICONS: Record<string, string> = {
  appetizer: '\uD83E\uDD57',
  starter: '\uD83E\uDD57',
  main: '\uD83C\uDF5B',
  'main course': '\uD83C\uDF5B',
  side: '\uD83C\uDF72',
  dessert: '\uD83C\uDF70',
  drink: '\uD83C\uDF79',
  beverage: '\uD83C\uDF79',
  soup: '\uD83C\uDF5C',
  salad: '\uD83E\uDD57',
  sauce: '\uD83E\uDED5',
  grill: '\uD83C\uDF56',
  bbq: '\uD83C\uDF56',
  korean: '\uD83C\uDDF0\uD83C\uDDF7',
  rice: '\uD83C\uDF5A',
  noodle: '\uD83C\uDF5C',
};

const FREQ_KEY = 'kw_recipe_freq';

function getFrequencyMap(): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem(FREQ_KEY) || '{}');
  } catch { return {}; }
}

export function trackRecipeOpen(recipeId: number) {
  const freq = getFrequencyMap();
  freq[recipeId] = (freq[recipeId] || 0) + 1;
  try { localStorage.setItem(FREQ_KEY, JSON.stringify(freq)); } catch { /* */ }
}

function getCatIcon(cat: Category): string {
  if (cat.icon) return cat.icon;
  const lower = cat.name.toLowerCase();
  for (const [key, icon] of Object.entries(CAT_FALLBACK_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '\uD83C\uDF7D\uFE0F';
}

export default function CookingGuideBrowse({ onSelectRecipe, onBack }: Props) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/recipes?mode=cooking_guide');
        if (!res.ok) throw new Error('Failed to fetch recipes');
        const data = await res.json();
        setRecipes(data.cooking_guide || []);
        const cookingCats = (data.categories || []).filter(
          (c: Category) => c.mode === 'cooking_guide' && c.recipe_count > 0
        );
        setCategories(cookingCats);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // When a category is selected, show filtered recipe list
  const filteredByCategory = activeCategory !== null
    ? recipes.filter(r => r.x_recipe_category_id && r.x_recipe_category_id[0] === activeCategory)
    : [];

  // Search across all recipes
  const searchResults = search
    ? recipes.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  // Top 10 quick picks: most-opened recipes first (tracked in localStorage),
  // with an alphabetical fallback for new users who haven't built frequency yet.
  const quickPicks = (() => {
    const freq = getFrequencyMap();
    const withFreq = recipes.map(r => ({ ...r, _freq: freq[r.id] || 0 }));
    withFreq.sort((a, b) => b._freq - a._freq);
    const frequent = withFreq.filter(r => r._freq > 0).slice(0, 10);
    if (frequent.length > 0) return frequent;
    return [...recipes]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .slice(0, 10);
  })();

  // Category view: show recipe list for selected category
  if (activeCategory !== null) {
    const cat = categories.find(c => c.id === activeCategory);
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px]">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveCategory(null)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1">
              <h1 className="text-[20px] font-bold text-white">{cat?.name || 'Category'}</h1>
              <p className="text-[12px] text-white/40 mt-0.5">{filteredByCategory.length} dishes</p>
            </div>
          </div>
        </div>

        <div className="px-5 pt-4 pb-8 flex-1">
          {filteredByCategory.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[14px] text-gray-500">No dishes in this category</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredByCategory.map(recipe => (
                <button
                  key={recipe.id}
                  onClick={() => onSelectRecipe(recipe)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-left active:scale-[0.98] transition-transform flex items-center gap-3"
                >
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {recipe.image_128
                      ? <img src={`data:image/png;base64,${recipe.image_128}`} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xl">{'\uD83C\uDF5B'}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-gray-900 truncate">{recipe.name}</div>
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">{recipe.x_recipe_step_count} steps</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2" className="flex-shrink-0">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main view: categories + quick picks
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Cooking Guide</h1>
            <p className="text-[12px] text-white/40 mt-0.5">Select a category or quick pick</p>
          </div>
        </div>

        {/* Search */}
        <div className="mt-4 flex items-center gap-2.5 px-4 py-3 bg-white/10 rounded-xl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search all dishes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[14px] text-white placeholder-white/40 outline-none bg-transparent"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-white/40 active:text-white/60">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-[13px] text-red-800 font-semibold">Failed to load</p>
          <p className="text-[12px] text-red-600 mt-1">{error}</p>
        </div>
      )}

      {/* Search results overlay */}
      {search && !loading && (
        <div className="px-5 pt-4 pb-8 flex-1">
          <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-3">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </div>
          {searchResults.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">{'\uD83D\uDD0D'}</div>
              <p className="text-[13px] text-gray-500">No dishes found</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {searchResults.map(recipe => (
                <button
                  key={recipe.id}
                  onClick={() => onSelectRecipe(recipe)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-3.5 text-left active:scale-[0.98] transition-transform flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {recipe.image_128
                      ? <img src={`data:image/png;base64,${recipe.image_128}`} alt="" className="w-full h-full object-cover" />
                      : <span className="text-lg">{'\uD83C\uDF5B'}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-gray-900 truncate">{recipe.name}</div>
                    <div className="text-[11px] text-gray-400">{recipe.x_recipe_category_id ? recipe.x_recipe_category_id[1] : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Categories + Quick picks (hidden during search) */}
      {!search && !loading && !error && (
        <div className="flex-1 flex flex-col">
          {/* Category tiles */}
          <div className="px-5 pt-5">
            <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-3">
              Categories
            </div>
            <div className="grid grid-cols-3 gap-3">
              {categories.map((cat, idx) => {
                const color = CAT_COLORS[idx % CAT_COLORS.length];
                const icon = getCatIcon(cat);
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`${color.bg} rounded-2xl p-4 flex flex-col items-center justify-center gap-2 aspect-square active:opacity-85 active:scale-[0.96] transition-all shadow-lg`}
                  >
                    <span className="text-[32px] leading-none drop-shadow-sm">{icon}</span>
                    <span className="text-[12px] font-bold text-white text-center leading-tight line-clamp-2">{cat.name}</span>
                    <span className="text-[10px] text-white/60 font-medium">{cat.recipe_count}</span>
                  </button>
                );
              })}

              {/* All dishes button */}
              <button
                onClick={() => setSearch(' ')}
                className="bg-gray-800 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 aspect-square active:opacity-85 active:scale-[0.96] transition-all shadow-lg"
              >
                <span className="text-[32px] leading-none">{'\uD83D\uDCCB'}</span>
                <span className="text-[12px] font-bold text-white text-center leading-tight">All Dishes</span>
                <span className="text-[10px] text-white/60 font-medium">{recipes.length}</span>
              </button>
            </div>
          </div>

          {/* Quick picks */}
          {quickPicks.length > 0 && (
            <div className="px-5 pt-6 pb-8">
              <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-3">
                Quick picks
              </div>
              <div className="flex flex-wrap gap-2">
                {quickPicks.map(recipe => (
                  <button
                    key={recipe.id}
                    onClick={() => onSelectRecipe(recipe)}
                    className="bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2 active:bg-green-50 active:border-green-300 active:scale-[0.97] transition-all"
                  >
                    <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {recipe.image_128
                        ? <img src={`data:image/png;base64,${recipe.image_128}`} alt="" className="w-full h-full object-cover" />
                        : <span className="text-sm">{'\uD83C\uDF5B'}</span>
                      }
                    </div>
                    <span className="text-[13px] font-semibold text-gray-900 whitespace-nowrap">{recipe.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
