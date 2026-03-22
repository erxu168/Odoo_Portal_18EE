'use client';

import React, { useState, useRef } from 'react';

export interface RecordedStep {
  id: string;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string;
  photos: string[];
}

interface Props {
  recipeName: string;
  mode: 'cooking' | 'production';
  initialSteps?: RecordedStep[];
  onFinish: (steps: RecordedStep[]) => void;
  onBack: () => void;
}

export default function ActiveRecording({ recipeName, mode, initialSteps, onFinish, onBack }: Props) {
  const [steps, setSteps] = useState<RecordedStep[]>(initialSteps || []);
  const [instruction, setInstruction] = useState('');
  const [stepType, setStepType] = useState<'prep' | 'cook' | 'plate'>('prep');
  const [timerMin, setTimerMin] = useState(0);
  const [tip, setTip] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  React.useEffect(() => {
    if (!recording) return;
    timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotos(prev => [...prev, reader.result as string]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function buildCurrentStep(): RecordedStep | null {
    if (!instruction.trim()) return null;
    return {
      id: `step_${Date.now()}`, step_type: stepType,
      instruction: instruction.trim(), timer_seconds: timerMin * 60,
      tip: tip.trim(), photos: [...photos],
    };
  }

  function saveStep() {
    const newStep = buildCurrentStep();
    if (!newStep) return;
    setSteps(prev => [...prev, newStep]);
    setInstruction(''); setTimerMin(0); setTip(''); setPhotos([]);
  }

  // FIX F2: Build final array synchronously — no stale state
  function handleFinishRecording() {
    setRecording(false);
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    onFinish(finalSteps);
  }

  function handleExit() {
    if (!confirm('End recording? You can still review and submit saved steps.')) return;
    // Save any in-progress step, then go back
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    setRecording(false);
    onFinish(finalSteps);
  }

  const hasContent = instruction.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#111] flex flex-col">
      <div className="px-5 pt-14 pb-3 flex items-center gap-3">
        <button onClick={handleExit} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div className="flex-1 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[14px] font-bold text-white font-mono">{formatElapsed(elapsed)}</span>
          <span className="text-[12px] text-white/40 bg-white/10 px-2 py-0.5 rounded">{steps.length} steps</span>
        </div>
        <button onClick={handleFinishRecording} className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-[13px] font-bold text-red-400 active:bg-red-500/30">End</button>
      </div>
      <div className="px-5 py-2">
        <div className="text-[11px] text-white/40 font-semibold">{recipeName} {'\u00b7'} {mode === 'cooking' ? 'Cooking' : 'Production'}</div>
      </div>
      <div className="px-5 mb-3">
        <button onClick={() => fileRef.current?.click()}
          className="w-full h-32 rounded-2xl bg-white/5 border border-white/10 border-dashed flex flex-col items-center justify-center active:bg-white/10">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="text-[12px] text-white/40 mt-2">Tap to take photo</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
      </div>
      {photos.length > 0 && (
        <div className="px-5 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {photos.map((p, i) => (
            <div key={i} className="w-16 h-16 rounded-xl bg-white/10 flex-shrink-0 relative overflow-hidden">
              <img src={p} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="px-5 flex-1">
        <div className="mb-3">
          <div className="flex gap-1.5 mb-2">
            {(['prep', 'cook', 'plate'] as const).map(t => (
              <button key={t} onClick={() => setStepType(t)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-bold capitalize transition-colors ${
                  stepType === t ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'
                }`}>{t}</button>
            ))}
          </div>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe this step..." rows={3}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-[14px] text-white placeholder-white/30 resize-none" />
        </div>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[12px] text-white/40 font-semibold">Timer</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setTimerMin(Math.max(0, timerMin - 1))} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/60 active:bg-white/20">-</button>
            <span className="text-[16px] font-bold text-white font-mono w-8 text-center">{timerMin}</span>
            <button onClick={() => setTimerMin(timerMin + 1)} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/60 active:bg-white/20">+</button>
            <span className="text-[12px] text-white/40">min</span>
          </div>
        </div>
        <input type="text" value={tip} onChange={(e) => setTip(e.target.value)}
          placeholder="Chef tip (optional)"
          className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[13px] text-white placeholder-white/30 mb-3" />
      </div>
      <div className="px-5 py-4 flex gap-3">
        <button onClick={saveStep} disabled={!hasContent}
          className={`flex-1 py-3.5 rounded-2xl text-[15px] font-bold transition-all ${
            hasContent ? 'bg-green-600 text-white active:bg-green-700' : 'bg-white/10 text-white/30'
          }`}>Save step +</button>
        <button onClick={handleFinishRecording}
          className="px-6 py-3.5 rounded-2xl text-[15px] font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10 active:bg-amber-400/20">Finish</button>
      </div>
    </div>
  );
}
