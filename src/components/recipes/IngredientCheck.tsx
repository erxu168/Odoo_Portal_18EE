'use client';

import React, { useState, useMemo } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface StepIngredient { id: number; name: string; qty: number; uom: string; uom_id: number | null; }
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
  onHome?: () => void;
  onStartCook: () => void;
}

export default function IngredientCheck({ mode, recipeName, steps, multiplier, onBack, onHome, onStartCook }: Props) {
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

  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-blue-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-blue-700';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Gather Ingredients" subtitle={recipeName} showBack onBack={onBack} />
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
                {(() => {
                  const scaled = ing.qty > 0 ? Math.round(ing.qty * (multiplier || 1) * 100) / 100 : 0;
                  if (!scaled && !ing.uom) return null;
                  return (
                    <div className={`text-[13px] font-mono font-semibold flex-shrink-0 ${isChecked ? 'text-gray-300' : 'text-gray-600'}`}>
                      {scaled > 0 ? `${scaled} ` : ''}{ing.uom}
                    </div>
                  );
                })()}
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
        <div className="px-5 py-4">
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
