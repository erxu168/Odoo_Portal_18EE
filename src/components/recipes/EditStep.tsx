'use client';

import React, { useState, useRef } from 'react';
import type { RecordedStep } from './ActiveRecording';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';

const MAX_PHOTO_MB = 5;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

interface Props {
  step: RecordedStep;
  stepIndex: number;
  onSave: (updated: RecordedStep) => void;
  onBack: () => void;
  onHome: () => void;
}

function formatTimerDisplay(sec: number): string {
  if (sec === 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

export default function EditStep({ step, stepIndex, onSave, onBack, onHome }: Props) {
  const [stepType, setStepType] = useState(step.step_type);
  const [instruction, setInstruction] = useState(step.instruction);
  const [timerSec, setTimerSec] = useState(step.timer_seconds);
  const [tip, setTip] = useState(step.tip);
  const [photos, setPhotos] = useState<string[]>([...step.photos]);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // P8: Photo size validation
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
      if (typeof reader.result === 'string') {
        setPhotos(prev => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // P7: Timer increment helpers
  function addTimerSeconds(sec: number) {
    setTimerSec(prev => Math.max(0, prev + sec));
  }

  // P11: Warn if instruction is empty before saving
  function handleSave() {
    if (!instruction.trim()) {
      setShowDeleteConfirm(true);
      return;
    }
    onSave({ ...step, step_type: stepType, instruction: instruction.trim(), timer_seconds: timerSec, tip: tip.trim(), photos });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={() => setToast(null)} />}

      {/* P11: Confirm delete when saving with empty instruction */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete this step?"
          message="The instruction is empty. Saving will remove this step from the recipe."
          confirmLabel="Delete step"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => { setShowDeleteConfirm(false); onSave({ ...step, instruction: '' }); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Edit Step {stepIndex + 1}</h1>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
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
            rows={4} maxLength={2000}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] text-gray-900 resize-none bg-white" />
          {!instruction.trim() && (
            <p className="text-[11px] text-amber-600 mt-1">Empty instruction will delete this step on save</p>
          )}
        </div>

        {/* P7: Timer with seconds precision */}
        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Timer</label>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-12 px-5 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-[22px] font-bold text-gray-900 font-mono">
              {formatTimerDisplay(timerSec)}
            </div>
            {timerSec > 0 && (
              <button onClick={() => setTimerSec(0)} className="px-3 py-2 rounded-lg bg-red-50 text-[12px] text-red-600 font-semibold active:bg-red-100 border border-red-200">Clear</button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => addTimerSeconds(15)} className="px-3 py-2 rounded-lg bg-gray-100 text-[12px] text-gray-600 active:bg-gray-200 font-mono border border-gray-200">+15s</button>
            <button onClick={() => addTimerSeconds(30)} className="px-3 py-2 rounded-lg bg-gray-100 text-[12px] text-gray-600 active:bg-gray-200 font-mono border border-gray-200">+30s</button>
            <button onClick={() => addTimerSeconds(60)} className="px-3 py-2 rounded-lg bg-gray-100 text-[12px] text-gray-600 active:bg-gray-200 font-mono border border-gray-200">+1m</button>
            <button onClick={() => addTimerSeconds(300)} className="px-3 py-2 rounded-lg bg-gray-100 text-[12px] text-gray-600 active:bg-gray-200 font-mono border border-gray-200">+5m</button>
            <button onClick={() => addTimerSeconds(600)} className="px-3 py-2 rounded-lg bg-gray-100 text-[12px] text-gray-600 active:bg-gray-200 font-mono border border-gray-200">+10m</button>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[13px] font-bold text-gray-900 mb-2 block">Chef tip</label>
          <input type="text" value={tip} onChange={(e) => setTip(e.target.value)}
            placeholder="Optional tip for the cook" maxLength={500}
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
