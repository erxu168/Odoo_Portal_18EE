'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';

interface StepData {
  id: number;
  sequence: number;
  step_type: string;
  instruction: string;
  timer_seconds: number;
  tip: string;
  image_count: number;
  ingredients: { id: number; name: string; qty: number; uom: string; uom_id: number | null }[];
}

interface Props {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  difficulty?: string;
  categoryName?: string;
  productQty?: number;
  onBack: () => void;
  onHome?: () => void;
  onStartCooking: (steps: StepData[]) => void;
  onEdit?: () => void;
  userRole?: string;
}

const DIFF: Record<string, { bg: string; text: string; label: string }> = {
  easy: { bg: 'bg-green-100', text: 'text-green-800', label: 'Easy' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Medium' },
  hard: { bg: 'bg-red-100', text: 'text-red-800', label: 'Hard' },
};

const TYPE_EMOJI: Record<string, React.ReactNode> = { prep: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2l10 10-3 3L3 5z"/><path d="M16 12l6 6-3 3-6-6"/></svg>, cook: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1012 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>, plate: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg> };

/** Extract first sentence from HTML instruction */
function firstSentence(html: string): string {
  const plain = html.replace(/<[^>]*>/g, '').trim();
  // Split on period followed by space + uppercase (same logic as CookMode)
  const match = plain.match(/^(.+?\.)(?=\s+[A-Z])/);
  return match ? match[1] : plain;
}

export default function RecipeOverview({
  mode, recipeId, recipeName, difficulty, categoryName, productQty,
  onBack, onHome, onStartCooking, onEdit, userRole,
}: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);

  // Manager/admin: feature this dish on the Cooking Board for the active restaurant.
  const { companyId } = useCompany();
  const canFeature = userRole === 'manager' || userRole === 'admin';
  const [featured, setFeatured] = useState(false);
  const [featBusy, setFeatBusy] = useState(false);

  useEffect(() => {
    if (!canFeature || !companyId) return;
    fetch(`/api/recipes/featured?company_id=${companyId}&mode=${mode}`)
      .then(r => (r.ok ? r.json() : { featured: [], source: 'manual' }))
      .then(d => setFeatured(d.source === 'manual' && (d.featured || []).some((f: { recipe_id: number }) => f.recipe_id === recipeId)))
      .catch(() => {});
  }, [canFeature, companyId, mode, recipeId]);

  async function toggleFeatured() {
    if (!companyId || featBusy) return;
    setFeatBusy(true);
    const next = !featured;
    try {
      const res = await fetch('/api/recipes/featured', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId, mode, recipe_id: recipeId,
          recipe_name: recipeName, base_qty: mode === 'cooking' ? 1 : (productQty || 10),
        }),
      });
      if (res.ok) setFeatured(next);
    } catch { /* ignore */ } finally { setFeatBusy(false); }
  }

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
  const emoji = mode === 'cooking' ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>;
  const modeLabel = mode === 'cooking' ? 'COOKING GUIDE' : 'PRODUCTION GUIDE';
  const modeBg = mode === 'cooking' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-blue-800';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader
        title={recipeName}
        subtitle={categoryName || (mode === 'cooking' ? 'Cooking Guide' : 'Production Guide')}
        showBack
        onBack={onBack}
        action={(canFeature || onEdit) ? (
          <div className="flex items-center gap-2">
            {canFeature && (
              <button onClick={toggleFeatured} disabled={featBusy}
                className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center active:bg-white/25 disabled:opacity-50"
                aria-label={featured ? 'Remove from board' : 'Feature on board'}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill={featured ? '#FBBF24' : 'none'} stroke={featured ? '#FBBF24' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center active:bg-white/25" aria-label="Edit">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            )}
          </div>
        ) : undefined}
      />

      <div className="px-5 pt-5 pb-8 flex-1">
        <div className="w-full h-40 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-6xl mb-4">{emoji}</div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${modeBg}`}>{modeLabel}</span>
          {diff && <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>{diff.label}</span>}
          {mode === 'production' && productQty && <span className="text-[11px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{productQty} kg base</span>}
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
                const stepEmoji = TYPE_EMOJI[step.step_type] || <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 00-8 0v2"/></svg>;
                const summary = step.instruction ? firstSentence(step.instruction) : `Step ${i + 1}`;
                return (
                  <div key={step.id} className="flex items-start gap-3 py-3 px-3.5 bg-white rounded-xl border border-gray-100">
                    <div className={`w-8 h-8 rounded-lg ${mode === 'cooking' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-blue-700'} flex items-center justify-center text-[13px] font-bold font-mono flex-shrink-0`}>{i + 1}</div>
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
            <div className="text-3xl mb-2">{<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}</div>
            <p className="text-[14px] font-semibold text-amber-900">No chef guide yet</p>
            <p className="text-[12px] text-amber-700 mt-1">Use the Record feature to create a step-by-step guide for this dish.</p>
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        <button
          onClick={() => onStartCooking(steps)}
          disabled={steps.length === 0}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            steps.length > 0
              ? `${mode === 'cooking' ? 'bg-green-600 active:bg-green-700' : 'bg-blue-600 active:bg-blue-700'} shadow-lg`
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {steps.length > 0 ? `Start ${mode === 'cooking' ? 'cooking' : 'production'} \u2192` : 'No guide recorded yet'}
        </button>
      </div>
    </div>
  );
}
