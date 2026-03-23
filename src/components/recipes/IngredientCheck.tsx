'use client';

import React, { useState, useMemo } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface StepIngredient { id: number; name: string; uom: string; }
interface StepData {
  id: number; sequence: number; step_type: string; instruction: string;
  timer_seconds: number; tip: string; image_count: number;
  ingredients: StepIngredient[];
}

interface Props {
  mode: 'cooking' | 'production';
  recipeName: string;
  steps: StepData[];
  multiplier: number;
  onBack: () => void;
  onHome: () => void;
  onStartCook: () => void;
}

export default function IngredientCheck({ mode, recipeName, steps, onBack, onHome, onStartCook }: Props) {
  const ingredients = useMemo(() => {
    const map = new Map<number, StepIngredient>();
    for (const s of steps) {
      for (const ing of (s.ingredients || [])) {
        if (!map.has(ing.id)) map.set(ing.id, ing);
      }
    }
    return Array.from(map.values());
  }, [steps]);

  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const allChecked = checkedCount >= ingredients.length;

  function toggle(id: number) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function skipCheck() {
    setShowSkipConfirm(true);
  }

  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-purple-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-purple-700';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Gather Ingredients</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{recipeName}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-4 pb-32 flex-1">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-bold text-gray-900">Ingredients</div>
          <div className={`text-[13px] font-bold font-mono px-3 py-1 rounded-full ${allChecked ? `${accentBg} text-white` : 'bg-gray-200 text-gray-600'}`}>
            {checkedCount}/{ingredients.length}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {ingredients.map(ing => {
            const isChecked = !!checked[ing.id];
            return (
              <button key={ing.id} onClick={() => toggle(ing.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all text-left ${
                  isChecked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
                } active:scale-[0.98]`}>
                <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isChecked ? `${accentBg} border-transparent` : 'border-gray-300 bg-white'
                }`}>
                  {isChecked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[14px] font-semibold ${isChecked ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{ing.name}</div>
                </div>
                {ing.uom && <div className="text-[12px] text-gray-400 font-mono flex-shrink-0">{ing.uom}</div>}
              </button>
            );
          })}
        </div>
        {ingredients.length === 0 && (
          <div className="text-center py-8">
            <p className="text-[13px] text-gray-500">No ingredients listed for this recipe.</p>
            <button onClick={onStartCook} className={`mt-4 px-6 py-3 ${accentBg} text-white font-semibold rounded-xl ${accentActive}`}>
              Continue to cooking
            </button>
          </div>
        )}
      </div>
      {ingredients.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
          <button onClick={onStartCook} disabled={!allChecked}
            className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
              allChecked ? `${accentBg} ${accentActive} shadow-lg` : 'bg-gray-300 cursor-not-allowed'
            }`}>
            {allChecked ? 'All set! Start cooking \u2192' : 'Check all items to start \u2192'}
          </button>
          <button onClick={skipCheck} className="w-full mt-2 py-2 text-[13px] text-gray-500 font-medium active:text-gray-700">
            Skip check \u2014 I have everything
          </button>
        </div>
      )}
      {showSkipConfirm && (
        <ConfirmDialog
          title="Skip ingredient check?"
          message="You'll go straight to cooking without verifying you have everything."
          confirmLabel="Skip and cook"
          cancelLabel="Go back"
          variant="primary"
          onConfirm={() => { setShowSkipConfirm(false); onStartCook(); }}
          onCancel={() => setShowSkipConfirm(false)}
        />
      )}
    </div>
  );
}
