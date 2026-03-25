'use client';

import React, { useState, useEffect } from 'react';
import Toast from '@/components/ui/Toast';

interface StepData {
  id: number;
  sequence: number;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string;
  image_count: number;
}

interface RecordedStep {
  id: string;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string;
  photos: string[];
  ingredientIds: string[];
}

interface Props {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  difficulty?: string;
  categoryName?: string;
  productQty?: number;
  isPublished: boolean;
  userRole: string;
  onEditMetadata: () => void;
  onEditSteps: (steps: RecordedStep[]) => void;
  onTogglePublish: () => void;
  onDelete: () => void;
  onBack: () => void;
  onHome: () => void;
}

const DIFF: Record<string, { bg: string; text: string; label: string }> = {
  easy: { bg: 'bg-green-100', text: 'text-green-800', label: 'Easy' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Medium' },
  hard: { bg: 'bg-red-100', text: 'text-red-800', label: 'Hard' },
};

const TYPE_EMOJI: Record<string, React.ReactNode> = { prep: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2l10 10-3 3L3 5z"/><path d="M16 12l6 6-3 3-6-6"/></svg>, cook: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1012 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>, plate: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg> };

function firstSentence(html: string): string {
  const plain = html.replace(/<[^>]*>/g, '').trim();
  const match = plain.match(/^(.+?\.)(?=\s+[A-Z])/);
  return match ? match[1] : plain;
}

export default function EditRecipeOverview({
  mode, recipeId, recipeName, difficulty, categoryName, productQty,
  isPublished, userRole,
  onEditMetadata, onEditSteps, onTogglePublish, onDelete, onBack, onHome,
}: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [loadProgress, setLoadProgress] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<'unpublish' | 'publish' | 'delete' | null>(null);

  const canManagePublish = userRole === 'admin' || userRole === 'manager';
  const canDelete = userRole === 'admin';

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

  async function handleEditSteps() {
    setLoadingSteps(true);
    setLoadProgress('Loading steps...');
    try {
      const stepsWithImages = steps.filter(s => s.image_count > 0);
      let loaded = 0;

      const recordedSteps: RecordedStep[] = await Promise.all(
        steps.map(async (step) => {
          let photos: string[] = [];
          if (step.image_count > 0) {
            try {
              const imgRes = await fetch(`/api/recipes/steps/images?step_id=${step.id}`);
              if (imgRes.ok) {
                const imgData = await imgRes.json();
                photos = (imgData.images || [])
                  .filter((img: { image: string }) => img?.image)
                  .map((img: { image: string }) =>
                    img.image.startsWith('data:') ? img.image : `data:image/png;base64,${img.image}`
                  );
              }
            } catch { /* skip failed images */ }
            loaded++;
            setLoadProgress(`Loading images... ${loaded}/${stepsWithImages.length}`);
          }
          return {
            id: `step_${step.id}`,
            step_type: step.step_type as 'prep' | 'cook' | 'plate',
            instruction: step.instruction,
            timer_seconds: step.timer_seconds,
            tip: step.tip || '',
            photos,
            ingredientIds: [],
          };
        })
      );

      onEditSteps(recordedSteps);
    } catch (e) {
      setToast({ msg: 'Failed to load step images', type: 'error' });
    } finally {
      setLoadingSteps(false);
      setLoadProgress('');
    }
  }

  const totalTime = steps.reduce((s, st) => s + (st.timer_seconds || 0), 0);
  const diff = difficulty ? DIFF[difficulty] : null;
  const emoji = mode === 'cooking' ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>;
  const modeLabel = mode === 'cooking' ? 'COOKING GUIDE' : 'PRODUCTION GUIDE';
  const modeBg = mode === 'cooking' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800';
  const accentBg = mode === 'cooking' ? 'bg-green-600 active:bg-green-700' : 'bg-purple-600 active:bg-purple-700';
  const accentLight = mode === 'cooking' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-purple-50 text-purple-700 border-purple-200';
  const spinnerBorder = mode === 'cooking' ? 'border-green-600' : 'border-purple-600';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={() => setToast(null)} />}

      {/* Confirm Dialog Overlay */}
      {confirmAction && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-end justify-center" onClick={() => setConfirmAction(null)}>
          <div className="w-full max-w-lg bg-white rounded-t-3xl px-5 pt-6 pb-8 animate-[slideUp_0.2s_ease-out]" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">{confirmAction === 'delete' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/></svg>}</div>
              <h3 className="text-[18px] font-bold text-gray-900 mb-2">
                {confirmAction === 'delete' ? 'Delete this recipe?' : confirmAction === 'unpublish' ? 'Unpublish this recipe?' : 'Publish this recipe?'}
              </h3>
              <p className="text-[14px] text-gray-500">
                {confirmAction === 'delete'
                  ? 'This will remove it from all guides. This cannot be undone.'
                  : confirmAction === 'unpublish'
                  ? 'It will no longer appear in the cooking/production guide for staff.'
                  : 'It will become visible in the guide for all staff.'}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-semibold text-gray-700 bg-gray-100 active:bg-gray-200"
              >Cancel</button>
              <button
                onClick={() => {
                  setConfirmAction(null);
                  if (confirmAction === 'delete') onDelete();
                  else onTogglePublish();
                }}
                className={`flex-1 py-3.5 rounded-xl text-[15px] font-semibold text-white ${
                  confirmAction === 'delete' ? 'bg-red-600 active:bg-red-700' : accentBg
                }`}
              >{confirmAction === 'delete' ? 'Delete' : confirmAction === 'unpublish' ? 'Unpublish' : 'Publish'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for step images */}
      {loadingSteps && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 text-center shadow-xl">
            <div className={`w-10 h-10 border-3 ${spinnerBorder} border-t-transparent rounded-full animate-spin mx-auto mb-3`} />
            <p className="text-[14px] font-semibold text-gray-900">{loadProgress}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden rounded-b-[28px]">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-white truncate">{recipeName}</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">Edit recipe</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 flex-1">
        {/* Recipe info card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-3xl flex-shrink-0">{emoji}</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-bold text-gray-900 mb-1">{recipeName}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${modeBg}`}>{modeLabel}</span>
                {diff && <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>{diff.label}</span>}
                {categoryName && <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{categoryName}</span>}
                {isPublished
                  ? <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-800">Published</span>
                  : <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-600">Unpublished</span>
                }
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6 py-4 mt-3 border-t border-gray-100">
            <div className="text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">{totalTime > 0 ? Math.ceil(totalTime / 60) : '--'}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase">Minutes</div>
            </div>
            <div className="text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.length}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase">Steps</div>
            </div>
            <div className="text-center">
              <div className="text-[18px] font-bold text-gray-900 font-mono">{mode === 'cooking' ? '1' : (productQty || '--')}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase">{mode === 'cooking' ? 'Servings' : 'kg'}</div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-3 mb-5">
          <button
            onClick={onEditMetadata}
            className={`w-full py-4 rounded-2xl text-[15px] font-bold border ${accentLight} active:opacity-80 flex items-center justify-center gap-2`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit Details
          </button>
          <button
            onClick={handleEditSteps}
            disabled={loadingSteps}
            className={`w-full py-4 rounded-2xl text-[15px] font-bold text-white ${accentBg} shadow-lg flex items-center justify-center gap-2`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            Edit Steps ({steps.length})
          </button>
        </div>

        {/* Admin actions */}
        {(canManagePublish || canDelete) && (
          <div className="border-t border-gray-200 pt-4">
            <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">Admin actions</p>
            <div className="flex flex-col gap-2">
              {canManagePublish && (
                <button
                  onClick={() => setConfirmAction(isPublished ? 'unpublish' : 'publish')}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-gray-700 bg-gray-100 border border-gray-200 active:bg-gray-200 flex items-center justify-center gap-2"
                >
                  {isPublished ? (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>Unpublish</>
                  ) : (
                    <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Publish</>
                  )}
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setConfirmAction('delete')}
                  className="w-full py-3 rounded-xl text-[14px] font-semibold text-red-600 bg-red-50 border border-red-200 active:bg-red-100 flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  Delete Recipe
                </button>
              )}
            </div>
          </div>
        )}

        {/* Steps preview */}
        {loading && (
          <div className="flex items-center justify-center py-8 mt-4">
            <div className={`w-8 h-8 border-3 ${spinnerBorder} border-t-transparent rounded-full animate-spin`} />
          </div>
        )}
        {!loading && steps.length > 0 && (
          <div className="mt-5">
            <div className="text-[13px] font-bold text-gray-900 mb-3">Steps overview</div>
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => {
                const stepEmoji = TYPE_EMOJI[step.step_type] || <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 00-8 0v2"/></svg>;
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
                        {step.image_count > 0 && (
                          <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{step.image_count} photo{step.image_count > 1 ? 's' : ''}</span>
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
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center mt-5">
            <div className="text-3xl mb-2">{<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}</div>
            <p className="text-[14px] font-semibold text-amber-900">No steps recorded yet</p>
            <p className="text-[12px] text-amber-700 mt-1">Tap &quot;Edit Steps&quot; to add steps to this recipe.</p>
          </div>
        )}
      </div>
    </div>
  );
}
