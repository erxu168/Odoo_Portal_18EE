'use client';

import React from 'react';
import type { RecordedStep } from './ActiveRecording';

interface Props {
  recipeName: string;
  recipeId: number;
  mode: 'cooking' | 'production';
  steps: RecordedStep[];
  onEditStep: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onAddStep: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onHome: () => void;
  submitting: boolean;
}

const TYPE_EMOJI: Record<string, string> = { prep: '\ud83d\udd2a', cook: '\ud83d\udd25', plate: '\ud83c\udf7d\ufe0f' };

export default function RecordingSummary({ recipeName, steps, onEditStep, onDeleteStep, onAddStep, onSubmit, onBack, onHome, submitting }: Props) {
  const totalTime = steps.reduce((s, st) => s + (st.timer_seconds || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Review Recording</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{recipeName}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-4 pb-32 flex-1">
        <div className="flex items-center gap-6 py-3 mb-4 bg-white rounded-xl border border-gray-200 px-4">
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Steps</div>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{totalTime > 0 ? Math.ceil(totalTime / 60) : 0}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Minutes</div>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.filter(s => s.photos.length > 0).length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Photos</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-3.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-[14px] flex-shrink-0">
                  {TYPE_EMOJI[step.step_type] || '\ud83d\udc68\u200d\ud83c\udf73'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-bold text-gray-500">Step {i + 1}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{step.step_type}</span>
                    {step.timer_seconds > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">{Math.ceil(step.timer_seconds / 60)}m</span>}
                    {step.photos.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600">{step.photos.length} photo{step.photos.length > 1 ? 's' : ''}</span>}
                  </div>
                  <div className="text-[13px] text-gray-800 line-clamp-2">{step.instruction}</div>
                  {step.tip && <div className="text-[11px] text-amber-600 mt-1">{'\ud83d\udca1'} {step.tip}</div>}
                </div>
              </div>
              <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-gray-100">
                <button onClick={() => onEditStep(i)} className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-blue-600 bg-blue-50 active:bg-blue-100">Edit</button>
                <button onClick={() => { if (confirm(`Delete step ${i + 1}?`)) onDeleteStep(i); }}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-red-600 bg-red-50 active:bg-red-100">Delete</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onAddStep}
          className="w-full mt-3 py-3 rounded-xl border-2 border-dashed border-gray-300 text-[13px] font-semibold text-gray-500 active:bg-gray-100">
          + Add step
        </button>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        <button onClick={onSubmit} disabled={steps.length === 0 || submitting}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            steps.length > 0 && !submitting ? 'bg-green-600 shadow-lg active:bg-green-700' : 'bg-gray-300 cursor-not-allowed'
          }`}>
          {submitting ? 'Submitting...' : `Submit for review (${steps.length} steps)`}
        </button>
      </div>
    </div>
  );
}
