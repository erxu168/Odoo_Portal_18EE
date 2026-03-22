'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

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
  batch: number;
  multiplier: number;
  onExit: () => void;
  onComplete: (elapsed: number) => void;
}

const TYPE_EMOJI: Record<string, string> = { prep: '\ud83d\udd2a', cook: '\ud83d\udd25', plate: '\ud83c\udf7d\ufe0f' };

export default function CookMode({ mode, recipeName, steps, onExit, onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [timerLeft, setTimerLeft] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerDone, setTimerDone] = useState(false);
  const [overdue, setOverdue] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlating, setShowPlating] = useState(false);
  const [alertSound, setAlertSound] = useState(true);
  const [alertVibrate, setAlertVibrate] = useState(true);
  const [alertFlash, setAlertFlash] = useState(true);
  const [flashing, setFlashing] = useState(false);
  const startTime = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step = steps[currentStep];
  const hasTimer = step && step.timer_seconds > 0;
  const isLastStep = currentStep >= steps.length - 1;

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const triggerAlert = useCallback(() => {
    if (alertSound) {
      try {
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const o = ac.createOscillator(); const g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.frequency.value = 880; o.type = 'square'; g.gain.value = 0.3;
        o.start(); o.stop(ac.currentTime + 0.5);
      } catch (_e) { /* no audio */ }
    }
    if (alertVibrate && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (alertFlash) { setFlashing(true); setTimeout(() => setFlashing(false), 1000); }
  }, [alertSound, alertVibrate, alertFlash]);

  useEffect(() => {
    if (!timerRunning) return;
    intervalRef.current = setInterval(() => {
      setTimerLeft(prev => {
        if (prev <= 1) {
          setTimerDone(true);
          setTimerRunning(false);
          triggerAlert();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerRunning, triggerAlert]);

  useEffect(() => {
    if (!timerDone) return;
    const iv = setInterval(() => setOverdue(p => p + 1), 1000);
    return () => clearInterval(iv);
  }, [timerDone]);

  function startTimer() {
    if (!step) return;
    setTimerLeft(step.timer_seconds);
    setTimerTotal(step.timer_seconds);
    setTimerRunning(true);
    setTimerDone(false);
    setOverdue(0);
  }

  function pauseTimer() { setTimerRunning(false); }
  function resumeTimer() { setTimerRunning(true); }
  function skipTimer() {
    if (!confirm('Skip timer? Timer has not finished. Are you sure?')) return;
    stopTimer(); nextStep();
  }
  function stopTimer() {
    setTimerRunning(false); setTimerDone(false); setOverdue(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }
  function addTime(sec: number) { setTimerLeft(p => p + sec); setTimerTotal(p => p + sec); }
  function snooze(sec: number) {
    setTimerDone(false); setOverdue(0);
    setTimerLeft(sec); setTimerTotal(sec);
    setTimerRunning(true);
  }

  function nextStep() {
    stopTimer();
    if (isLastStep) { setShowPlating(true); }
    else { setCurrentStep(p => p + 1); }
  }

  function handleComplete() {
    const elapsed = Math.round((Date.now() - startTime.current) / 1000);
    onComplete(elapsed);
  }

  function handleExit() {
    if (!confirm('Exit cooking? Progress will be lost.')) return;
    stopTimer(); onExit();
  }

  function getTimerColor(): string {
    if (timerDone) return '#ef4444';
    if (timerTotal === 0) return '#22c55e';
    const pct = timerLeft / timerTotal;
    if (pct > 0.5) return '#22c55e';
    if (pct > 0.2) return '#f59e0b';
    return '#ef4444';
  }

  function formatTime(sec: number): string {
    const m = Math.floor(Math.abs(sec) / 60);
    const s = Math.abs(sec) % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const circumference = 2 * Math.PI * 60;
  const ringOffset = timerTotal > 0 ? circumference * (1 - timerLeft / timerTotal) : 0;

  if (showPlating) {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col">
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button onClick={() => setShowPlating(false)} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1"><div className="text-[20px] font-bold text-white">Plating</div><div className="text-[12px] text-white/50">Final step</div></div>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center">
            <div className="text-7xl mb-6">{'\ud83c\udf7d\ufe0f'}</div>
            <div className="text-[13px] font-semibold text-white/40 uppercase tracking-wider mb-2">Plating reference</div>
            <div className="text-[22px] font-bold text-white mb-4">{recipeName}</div>
            <p className="text-[14px] text-white/60 leading-relaxed">
              {mode === 'cooking'
                ? 'Plate the dish according to SSAM standards. Check the recipe photo for reference.'
                : 'Portion into containers. Label with date, batch #, and use-by instructions.'}
            </p>
          </div>
        </div>
        <div className="px-5 py-6">
          <button onClick={handleComplete}
            className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg">
            {'\u2713'} Dish complete
          </button>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const emoji = TYPE_EMOJI[step.step_type] || '\ud83d\udc68\u200d\ud83c\udf73';
  const instrText = step.instruction?.replace(/<[^>]*>/g, '') || `Step ${currentStep + 1}`;

  return (
    <div className={`min-h-screen bg-[#111] flex flex-col ${flashing ? 'animate-pulse bg-red-900' : ''}`}>
      <div className="px-5 pt-14 pb-2 flex items-center gap-3">
        <button onClick={handleExit} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div className="flex-1">
          <div className="text-[16px] font-bold text-white">Step {currentStep + 1} of {steps.length}</div>
          <div className="text-[12px] text-white/50">{recipeName}</div>
        </div>
        <button onClick={() => setShowSettings(true)} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 text-[18px]">
          {'\u2699\ufe0f'}
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-5 py-3">
        {steps.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full flex-1 transition-colors ${
            i < currentStep ? 'bg-green-500' : i === currentStep ? (mode === 'cooking' ? 'bg-green-400' : 'bg-purple-400') : 'bg-white/15'
          }`} />
        ))}
      </div>

      <div className="flex-1 px-5 py-4 overflow-y-auto">
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">{emoji}</div>
          <div className="text-[14px] font-bold text-white/70">{step.step_type.charAt(0).toUpperCase() + step.step_type.slice(1)}</div>
        </div>

        {step.ingredients && step.ingredients.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">{"You\u2019ll need"}</div>
            <div className="flex flex-wrap gap-1.5">
              {step.ingredients.map(ing => (
                <div key={ing.id} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/80">
                  {ing.uom && <span className="font-mono text-white/50 mr-1">{ing.uom}</span>}
                  {ing.name}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">Instructions</div>
          <div className="text-[15px] text-white/90 leading-relaxed whitespace-pre-wrap">{instrText}</div>
        </div>

        {step.tip && (
          <div className="bg-white/5 rounded-xl px-4 py-3 mb-4">
            <div className="text-[13px] text-amber-400">{'\ud83d\udca1'} {step.tip}</div>
          </div>
        )}

        {hasTimer && (
          <div className="flex flex-col items-center py-4">
            <svg width="160" height="160" viewBox="0 0 140 140" className="mb-3">
              <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
              <circle cx="70" cy="70" r="60" fill="none"
                stroke={getTimerColor()} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={ringOffset}
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.5s, stroke 0.5s' }} />
            </svg>
            <div className={`text-[36px] font-bold font-mono ${timerDone ? 'text-red-500' : 'text-white'}`}>
              {timerDone ? `+${formatTime(overdue)}` : formatTime(timerLeft)}
            </div>
            {timerDone && <div className="text-[13px] font-bold text-red-400 uppercase tracking-wider mt-1">OVERDUE</div>}
            {timerRunning && !timerDone && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => addTime(30)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/70 active:bg-white/20">+30s</button>
                <button onClick={() => addTime(60)} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-white/70 active:bg-white/20">+1m</button>
              </div>
            )}
            {timerDone && (
              <div className="flex gap-2 mt-3">
                <button onClick={() => snooze(60)} className="px-4 py-2 rounded-lg bg-white/10 text-[13px] text-white/80 font-semibold active:bg-white/20">+1 min</button>
                <button onClick={() => snooze(120)} className="px-4 py-2 rounded-lg bg-white/10 text-[13px] text-white/80 font-semibold active:bg-white/20">+2 min</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-4 space-y-2">
        {hasTimer && !timerRunning && !timerDone && timerLeft === 0 && (
          <button onClick={startTimer} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">
            {'\u25b6'}  Start timer
          </button>
        )}
        {hasTimer && timerRunning && (
          <button onClick={pauseTimer} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-amber-600 active:bg-amber-700">
            {'\u23f8'}  Pause
          </button>
        )}
        {hasTimer && !timerRunning && timerLeft > 0 && !timerDone && (
          <button onClick={resumeTimer} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">
            {'\u25b6'}  Resume
          </button>
        )}
        {hasTimer && timerDone && (
          <button onClick={nextStep} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">
            {isLastStep ? 'Done \u2192 Plating' : 'Done \u2192 Next step'}
          </button>
        )}
        {!hasTimer && (
          <button onClick={nextStep} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">
            {isLastStep ? 'Done \u2192 Plating' : 'Done \u2192 Next step'}
          </button>
        )}
        {hasTimer && timerRunning && (
          <button onClick={skipTimer} className="w-full py-2 text-[13px] text-white/50 font-medium active:text-white/70">
            Skip timer
          </button>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full bg-white rounded-t-3xl px-5 pt-5 pb-8 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mb-4" />
            <h3 className="text-[18px] font-bold text-gray-900 mb-4">Timer alert settings</h3>
            {[
              { label: 'Sound alert', desc: 'Play alarm when timer finishes', value: alertSound, set: setAlertSound },
              { label: 'Vibration', desc: 'Vibrate device when timer finishes', value: alertVibrate, set: setAlertVibrate },
              { label: 'Visual flash', desc: 'Screen flashes when timer finishes', value: alertFlash, set: setAlertFlash },
            ].map(setting => (
              <div key={setting.label} className="flex items-center justify-between py-3 border-b border-gray-100">
                <div>
                  <div className="text-[14px] font-semibold text-gray-900">{setting.label}</div>
                  <div className="text-[12px] text-gray-500">{setting.desc}</div>
                </div>
                <button onClick={() => setting.set(!setting.value)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${setting.value ? 'bg-green-600' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${setting.value ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
            <button onClick={() => setShowSettings(false)}
              className="w-full mt-6 py-3 rounded-2xl text-[15px] font-bold text-white bg-green-600 active:bg-green-700">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
