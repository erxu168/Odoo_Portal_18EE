'use client';

import React, { useState, useEffect } from 'react';

interface StepData {
  id: number;
  sequence: number;
  step_type: string;
  instruction: string;
  timer_seconds: number;
  tip: string;
  image_count: number;
  ingredients: { id: number; name: string; uom: string }[];
}

interface Props {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  difficulty?: string;
  categoryName?: string;
  batchUnit?: string;         // 'servings' or 'kg'
  defaultBatch?: number;      // 1 for cooking, 10 for production
  ingredientCount?: number;   // for production (from bom_line_ids)
  productQty?: number;        // for production (base kg)
  onBack: () => void;
  onHome: () => void;
  onStartCook: (recipeId: number, batch: number) => void;
}

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  easy:   { bg: 'bg-green-100', text: 'text-green-800', label: 'Easy' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Medium' },
  hard:   { bg: 'bg-red-100',   text: 'text-red-800',   label: 'Hard' },
};

const PRESETS_COOKING = [1, 2, 4, 6, 8];
const PRESETS_PRODUCTION = [5, 10, 15, 20, 25];

export default function RecipeDetail({
  mode, recipeId, recipeName, difficulty, categoryName,
  batchUnit, defaultBatch, ingredientCount, productQty,
  onBack, onHome, onStartCook,
}: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState(defaultBatch || (mode === 'cooking' ? 1 : 10));
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadVal, setNumpadVal] = useState('');

  const unit = batchUnit || (mode === 'cooking' ? 'servings' : 'kg');
  const baseBatch = defaultBatch || (mode === 'cooking' ? 1 : 10);
  const presets = mode === 'cooking' ? PRESETS_COOKING : PRESETS_PRODUCTION;
  const accent = mode === 'cooking' ? 'green' : 'purple';
  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-purple-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-purple-700';
  const emoji = mode === 'cooking' ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>;

  useEffect(() => {
    async function fetchSteps() {
      try {
        const param = mode === 'cooking'
          ? `product_tmpl_id=${recipeId}`
          : `bom_id=${recipeId}`;
        const res = await fetch(`/api/recipes/steps?${param}`);
        if (res.ok) {
          const data = await res.json();
          setSteps(data.steps || []);
        }
      } catch (e) {
        console.error('Failed to fetch steps:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchSteps();
  }, [recipeId, mode]);

  const totalTime = steps.reduce((sum, s) => sum + (s.timer_seconds || 0), 0);
  const prepSteps = steps.filter(s => s.step_type === 'prep');
  const cookSteps = steps.filter(s => s.step_type === 'cook');
  const plateSteps = steps.filter(s => s.step_type === 'plate');
  const diff = difficulty ? DIFFICULTY_STYLES[difficulty] : null;

  // Collect all unique ingredients from steps
  const allIngredients: { id: number; name: string; uom: string }[] = [];
  const seen = new Set<number>();
  for (const s of steps) {
    for (const ing of (s.ingredients || [])) {
      if (!seen.has(ing.id)) { seen.add(ing.id); allIngredients.push(ing); }
    }
  }

  function handleNumpadKey(key: string) {
    if (key === 'clear') { setNumpadVal(''); return; }
    if (key === 'back') { setNumpadVal(v => v.slice(0, -1)); return; }
    if (key === 'done') {
      const val = parseFloat(numpadVal);
      if (val > 0) setBatch(val);
      setShowNumpad(false);
      setNumpadVal('');
      return;
    }
    if (key === '.' && numpadVal.includes('.')) return;
    if (numpadVal.length >= 6) return;
    setNumpadVal(v => v + key);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
        <div className={`absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(${mode === 'cooking' ? '22,163,74' : '139,92,246'},0.08)_0%,transparent_70%)]`} />
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-white truncate">{recipeName}</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">{mode === 'cooking' ? 'Cooking Guide' : 'Production Guide'}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 flex-1">
        {/* Hero card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-xl ${mode === 'cooking' ? 'bg-orange-50' : 'bg-purple-50'} flex items-center justify-center text-3xl flex-shrink-0`}>
              {emoji}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-bold text-gray-900 truncate">{recipeName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {categoryName && <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{categoryName}</span>}
                {diff && <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>{diff.label}</span>}
                {mode === 'production' && productQty && (
                  <span className="text-[11px] font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{productQty} kg base</span>
                )}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="flex-1 text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.length}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Steps</div>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div className="flex-1 text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">
                {totalTime > 0 ? `${Math.ceil(totalTime / 60)}` : '--'}
              </div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Minutes</div>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div className="flex-1 text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">
                {allIngredients.length || ingredientCount || '--'}
              </div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Ingredients</div>
            </div>
          </div>
        </div>

        {/* Batch size selector */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
          <div className="text-[13px] font-bold text-gray-900 mb-3">
            Batch size ({unit})
          </div>
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => setBatch(Math.max(mode === 'cooking' ? 1 : 1, batch - (mode === 'cooking' ? 1 : 5)))}
              className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-200"
            >-</button>
            <button
              onClick={() => { setNumpadVal(String(batch)); setShowNumpad(true); }}
              className="flex-1 h-12 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-[22px] font-bold text-gray-900 font-mono active:bg-gray-100"
            >{batch}</button>
            <button
              onClick={() => setBatch(batch + (mode === 'cooking' ? 1 : 5))}
              className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-200"
            >+</button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setBatch(p)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-bold border transition-colors ${
                  batch === p
                    ? `${accentBg} text-white border-transparent`
                    : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                }`}
              >{p} {unit}</button>
            ))}
          </div>
        </div>

        {/* Step breakdown */}
        {steps.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
            <div className="text-[13px] font-bold text-gray-900 mb-3">Step breakdown</div>
            <div className="flex flex-col gap-2">
              {prepSteps.length > 0 && (
                <div className="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px]">\ud83d\udd2a</span>
                    <span className="text-[13px] font-semibold text-blue-800">Prep</span>
                  </div>
                  <span className="text-[12px] font-bold text-blue-600 font-mono">{prepSteps.length} steps</span>
                </div>
              )}
              {cookSteps.length > 0 && (
                <div className="flex items-center justify-between py-2 px-3 bg-orange-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px]">\ud83d\udd25</span>
                    <span className="text-[13px] font-semibold text-orange-800">Cook</span>
                  </div>
                  <span className="text-[12px] font-bold text-orange-600 font-mono">{cookSteps.length} steps</span>
                </div>
              )}
              {plateSteps.length > 0 && (
                <div className="flex items-center justify-between py-2 px-3 bg-green-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px]">\ud83c\udf7d\ufe0f</span>
                    <span className="text-[13px] font-semibold text-green-800">Plate</span>
                  </div>
                  <span className="text-[12px] font-bold text-green-600 font-mono">{plateSteps.length} steps</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ingredients preview */}
        {allIngredients.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
            <div className="text-[13px] font-bold text-gray-900 mb-3">Ingredients</div>
            <div className="flex flex-col gap-1.5">
              {allIngredients.map(ing => (
                <div key={ing.id} className="flex items-center justify-between py-1.5">
                  <span className="text-[13px] text-gray-700">{ing.name}</span>
                  {ing.uom && <span className="text-[11px] text-gray-400 font-mono">{ing.uom}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No steps state */}
        {!loading && steps.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center mb-4">
            <div className="text-3xl mb-2">\ud83d\udcdd</div>
            <p className="text-[14px] font-semibold text-amber-900">No chef guide yet</p>
            <p className="text-[12px] text-amber-700 mt-1">This dish has no step-by-step guide recorded. Use the Record feature to create one.</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className={`w-8 h-8 border-3 border-${accent}-600 border-t-transparent rounded-full animate-spin`} />
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-4 safe-area-bottom">
        <button
          onClick={() => onStartCook(recipeId, batch)}
          disabled={steps.length === 0}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            steps.length > 0
              ? `${accentBg} ${accentActive} shadow-lg`
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {steps.length > 0
            ? `Start ${mode === 'cooking' ? 'Cooking' : 'Production'} (${batch} ${unit})`
            : 'No guide recorded yet'
          }
        </button>
      </div>

      {/* Numpad overlay */}
      {showNumpad && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowNumpad(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full bg-white rounded-t-3xl px-5 pt-5 pb-8 safe-area-bottom" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Enter {unit}</span>
              <div className="text-[32px] font-bold text-gray-900 font-mono h-10 mt-1">
                {numpadVal || '0'}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9','.','0','back'].map(key => (
                <button
                  key={key}
                  onClick={() => handleNumpadKey(key)}
                  className="h-14 rounded-xl bg-gray-100 text-[20px] font-bold text-gray-800 active:bg-gray-200 flex items-center justify-center"
                >
                  {key === 'back'
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/></svg>
                    : key
                  }
                </button>
              ))}
            </div>
            <button
              onClick={() => handleNumpadKey('done')}
              className={`w-full mt-3 py-4 rounded-2xl text-[16px] font-bold text-white ${accentBg} ${accentActive}`}
            >Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
