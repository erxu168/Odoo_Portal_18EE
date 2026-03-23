'use client';

import React, { useState, useRef, useCallback } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';

export interface RecordedStep {
  id: string;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string;
  photos: string[];
}

const LS_KEY = 'kw_recording_steps';
const MAX_PHOTO_MB = 5;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

function loadSavedSteps(recipeName: string): RecordedStep[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.recipeName === recipeName && Array.isArray(data.steps)) return data.steps;
  } catch (_e) { /* */ }
  return [];
}

function saveStepsToStorage(recipeName: string, steps: RecordedStep[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ recipeName, steps, savedAt: Date.now() }));
  } catch (_e) { /* */ }
}

export function clearRecordingStorage() {
  try { localStorage.removeItem(LS_KEY); } catch (_e) { /* */ }
}

interface Props {
  recipeName: string;
  mode: 'cooking' | 'production';
  initialSteps?: RecordedStep[];
  onFinish: (steps: RecordedStep[]) => void;
  onBack: () => void;
  onHome: () => void;
}

export default function ActiveRecording({ recipeName, mode, initialSteps, onFinish, onBack, onHome }: Props) {
  const [steps, setSteps] = useState<RecordedStep[]>(() => {
    if (initialSteps && initialSteps.length > 0) return initialSteps;
    return loadSavedSteps(recipeName);
  });
  const [instruction, setInstruction] = useState('');
  const [stepType, setStepType] = useState<'prep' | 'cook' | 'plate'>('prep');
  const [timerSec, setTimerSec] = useState(0);
  const [tip, setTip] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(true);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  React.useEffect(() => {
    if (!recording) return;
    timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  // P9: Auto-save steps to localStorage whenever they change
  const updateSteps = useCallback((newSteps: RecordedStep[]) => {
    setSteps(newSteps);
    saveStepsToStorage(recipeName, newSteps);
  }, [recipeName]);

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatTimerDisplay(sec: number): string {
    if (sec === 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
  }

  // P8: Validate photo size before adding
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setToast({ msg: `Photo too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_PHOTO_MB}MB.`, type: 'error' });
      e.target.value = '';
      return;
    }
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
      instruction: instruction.trim(), timer_seconds: timerSec,
      tip: tip.trim(), photos: [...photos],
    };
  }

  function saveStep() {
    const newStep = buildCurrentStep();
    if (!newStep) return;
    const newSteps = [...stepsRef.current, newStep];
    updateSteps(newSteps);
    setInstruction(''); setTimerSec(0); setTip(''); setPhotos([]);
    setToast({ msg: `Step ${newSteps.length} saved`, type: 'success' });
  }

  function handleFinishRecording() {
    setRecording(false);
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    clearRecordingStorage();
    onFinish(finalSteps);
  }

  // P6: Replace confirm() with ConfirmDialog
  function handleExit() {
    setShowExitConfirm(true);
  }

  function confirmExit() {
    setShowExitConfirm(false);
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    setRecording(false);
    clearRecordingStorage();
    onFinish(finalSteps);
  }

  // P7: Timer increment helpers (seconds precision)
  function addTimerSeconds(sec: number) {
    setTimerSec(prev => Math.max(0, prev + sec));
  }

  const hasContent = instruction.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#111] flex flex-col">
      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={() => setToast(null)} duration={2000} />}

      {/* P6: ConfirmDialog for exit */}
      {showExitConfirm && (
        <ConfirmDialog
          title="End recording?"
          message="Your saved steps will be kept. You can still review and submit them."
          confirmLabel="End and review"
          cancelLabel="Keep recording"
          variant="danger"
          onConfirm={confirmExit}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}

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
        <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
        </button>
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
            placeholder="Describe this step..." rows={3} maxLength={2000}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-[14px] text-white placeholder-white/30 resize-none" />
        </div>

        {/* P7: Timer with seconds precision */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-white/40 font-semibold">Timer</span>
            <span className="text-[14px] font-bold text-white font-mono">{formatTimerDisplay(timerSec)}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => addTimerSeconds(30)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/60 active:bg-white/20 font-mono">+30s</button>
            <button onClick={() => addTimerSeconds(60)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/60 active:bg-white/20 font-mono">+1m</button>
            <button onClick={() => addTimerSeconds(300)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/60 active:bg-white/20 font-mono">+5m</button>
            <button onClick={() => addTimerSeconds(600)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/60 active:bg-white/20 font-mono">+10m</button>
            {timerSec > 0 && (
              <button onClick={() => setTimerSec(0)} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-[12px] text-red-400 active:bg-red-500/20 font-semibold">Clear</button>
            )}
          </div>
        </div>

        <input type="text" value={tip} onChange={(e) => setTip(e.target.value)}
          placeholder="Chef tip (optional)" maxLength={500}
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
