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
  productQty?: number;
  onBack: () => void;
  onHome: () => void;
  onStartCooking: (steps: StepData[]) => void;
  onEdit?: () => void;
  userRole?: string;
}

const DIFF: Record<string, { bg: string; text: string; label: string }> = {
  easy: { bg: 'bg-green-100', text: 'text-green-800', label: 'Easy' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Medium' },
  hard: { bg: 'bg-red-100', text: 'text-red-800', label: 'Hard' },
};

const TYPE_EMOJI: Record<string, string> = { prep: '\ud83d\udd2a', cook: '\ud83d\udd25', plate: '\ud83c\udf7d\ufe0f' };

/** Extract first sentence from HTML instruction */
function firstSentence(html: string): string {
  const plain = html.replace(/<[^>]*>/g, '').trim();
  // Split on period followed by space + uppercase (same logic as CookMode)
  const match = plain.match(/^(.+?\.)(?=\s+[A-Z])/);
  return match ? match[1] : plain;
}

export default function RecipeOverview({
  mode, recipeId, recipeName, difficulty, categoryName, productQty,
  onBack, onHome, onStartCooking, onEdit,
}: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const param = mode === 'cooking' ? `product_tmpl_id=${recipeId}` : `bom_id=${recipeId}`;
        const res = await fetch(`/api/recipes/steps?${param}`);
        if (res.ok) {
          const data = await res.json();
          setSteps(data.steps || []);
        }
      } catch (e) { console.error('Steps load error:', e); }
      finally { setLoading(false); }
    }
    load();
  }, [recipeId, mode]);

  const totalTime = steps.reduce((s, st) => s + (st.timer_seconds || 0), 0);
  const diff = difficulty ? DIFF[difficulty] : null;
  const spinnerBorder = mode === 'cooking' ? 'border-green-600' : 'border-purple-600';
  const emoji = mode === 'cooking' ? '\ud83c\udf73' : '\ud83c\udfed';
  const modeLabel = mode === 'cooking' ? 'COOKING GUIDE' : 'PRODUCTION GUIDE';
  const modeBg = mode === 'cooking' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-white truncate">{recipeName}</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{categoryName || (mode === 'cooking' ? 'Cooking Guide' : 'Production Guide')}</p>
          </div>
          {onEdit && (
            <button onClick={onEdit} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pt-5 pb-28 flex-1">
        <div className="w-full h-40 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-6xl mb-4">{emoji}</div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${modeBg}`}>{modeLabel}</span>
          {diff && <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>{diff.label}</span>}
          {mode === 'production' && productQty && <span className="text-[11px] font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{productQty} kg base</span>}
        </div>
        <h2 className="text-[20px] font-bold text-gray-900 mb-1">{recipeName}</h2>
        <div className="flex items-center gap-6 py-4 border-b border-gray-100 mb-4">
          <div className="text-center">
            <div className="text-[20px] font-bold text-gray-900 font-mono">{totalTime > 0 ? Math.ceil(totalTime / 60) : '--'}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Minutes</div>
          </div>
          <div className="text-center">
            <div className="text-[20px] font-bold text-gray-900 font-mono">{steps.length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Steps</div>
          </div>
          <div className="text-center">
            <div className="text-[20px] font-bold text-gray-900 font-mono">{mode === 'cooking' ? '1' : (productQty || '--')}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">{mode === 'cooking' ? 'Servings' : 'kg'}</div>
          </div>
        </div>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className={`w-8 h-8 border-3 ${spinnerBorder} border-t-transparent rounded-full animate-spin`} />
          </div>
        )}
        {!loading && steps.length > 0 && (
          <div>
            <div className="text-[13px] font-bold text-gray-900 mb-3">Steps overview</div>
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => {
                const stepEmoji = TYPE_EMOJI[step.step_type] || '\ud83d\udc68\u200d\ud83c\udf73';
                const summary = step.instruction ? firstSentence(step.instruction) : `Step ${i + 1}`;
                return (
                  <div key={step.id} className="flex items-start gap-3 py-3 px-3.5 bg-white rounded-xl border border-gray-100">
                    <div className={`w-8 h-8 rounded-lg ${mode === 'cooking' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'} flex items-center justify-center text-[13px] font-bold font-mono flex-shrink-0`}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[12px]">{stepEmoji}</span>
                        <span className="text-[11px] text-gray-400 font-semibold capitalize">{step.step_type}</span>
                        {step.timer_seconds > 0 && (
                          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-mono">{Math.ceil(step.timer_seconds / 60)}m</span>
                        )}
                      </div>
                      <div className="text-[13px] text-gray-700 leading-snug">{summary}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!loading && steps.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
            <div className="text-3xl mb-2">{'\ud83d\udcdd'}</div>
            <p className="text-[14px] font-semibold text-amber-900">No chef guide yet</p>
            <p className="text-[12px] text-amber-700 mt-1">Use the Record feature to create a step-by-step guide for this dish.</p>
          </div>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        <button
          onClick={() => onStartCooking(steps)}
          disabled={steps.length === 0}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            steps.length > 0
              ? `${mode === 'cooking' ? 'bg-green-600 active:bg-green-700' : 'bg-purple-600 active:bg-purple-700'} shadow-lg`
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {steps.length > 0 ? `Start ${mode === 'cooking' ? 'cooking' : 'production'} \u2192` : 'No guide recorded yet'}
        </button>
      </div>
    </div>
  );
}
