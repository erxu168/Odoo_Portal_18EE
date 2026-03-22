'use client';

import React, { useState, useRef } from 'react';
import type { RecordedStep } from './ActiveRecording';

interface Props {
  step: RecordedStep;
  stepIndex: number;
  onSave: (updated: RecordedStep) => void;
  onBack: () => void;
}

export default function EditStep({ step, stepIndex, onSave, onBack }: Props) {
  const [stepType, setStepType] = useState(step.step_type);
  const [instruction, setInstruction] = useState(step.instruction);
  const [timerMin, setTimerMin] = useState(Math.ceil(step.timer_seconds / 60));
  const [tip, setTip] = useState(step.tip);
  const [photos, setPhotos] = useState<string[]>([...step.photos]);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotos(prev => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleSave() {
    onSave({ ...step, step_type: stepType, instruction: instruction.trim(), timer_seconds: timerMin * 60, tip: tip.trim(), photos });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Edit Step {stepIndex + 1}</h1>
          </div>
        </div>
      </div>
      <div className="px-5 pt-5 pb-28 flex-1">
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Step type</label>
          <div className="flex gap-2">
            {(['prep', 'cook', 'plate'] as const).map(t => (
              <button key={t} onClick={() => setStepType(t)}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold capitalize border transition-colors ${
                  stepType === t ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'
                }`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Instruction</label>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
            rows={4} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] text-gray-900 resize-none bg-white" />
        </div>
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Timer (minutes)</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setTimerMin(Math.max(0, timerMin - 1))}
              className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-100">-</button>
            <div className="w-16 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[22px] font-bold text-gray-900 font-mono">{timerMin}</div>
            <button onClick={() => setTimerMin(timerMin + 1)}
              className="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[20px] font-bold text-gray-600 active:bg-gray-100">+</button>
            <span className="text-[14px] text-gray-500">min</span>
          </div>
        </div>
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Chef tip</label>
          <input type="text" value={tip} onChange={(e) => setTip(e.target.value)}
            placeholder="Optional tip for the cook"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] text-gray-900 bg-white" />
        </div>
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Photos</label>
          <div className="flex gap-2 flex-wrap">
            {photos.map((p, i) => (
              <div key={i} className="w-20 h-20 rounded-xl bg-gray-100 relative overflow-hidden">
                <img src={p} alt="" className="w-full h-full object-cover" />
                <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 active:bg-gray-50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        <button onClick={handleSave}
          className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg">
          Save changes
        </button>
      </div>
    </div>
  );
}
