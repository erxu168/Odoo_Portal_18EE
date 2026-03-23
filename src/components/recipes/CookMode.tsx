'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { type CookingSession, type StepImage, computeTimer, formatTimer } from '@/lib/cooking-sessions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const TYPE_LABEL: Record<string, string> = { prep: 'PREP', cook: 'COOK', plate: 'PLATE' };
const TYPE_COLOR: Record<string, string> = { prep: 'bg-blue-500/20 text-blue-400', cook: 'bg-orange-500/20 text-orange-400', plate: 'bg-emerald-500/20 text-emerald-400' };

function parseInstructions(html: string): string[] {
  if (!html) return [];
  let text = html.replace(/<\/?p>/gi, '').replace(/<br\s*\/?>/gi, '. ').trim();
  text = text.replace(/<(?!\/?b\b)[^>]*>/gi, '');
  const raw = text.split(/\.(?=\s+[A-Z])/).map(s => s.trim()).filter(s => s.length > 0);
  return raw.map(s => s.endsWith('.') ? s : s + '.');
}

function renderBulletText(text: string): React.ReactNode {
  const parts = text.split(/(<b>.*?<\/b>)/gi);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^<b>(.*?)<\/b>$/i);
    if (boldMatch) return <strong key={i} className="text-white font-bold">{boldMatch[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

function PhotoCarousel({ images }: { images: StepImage[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fsScrollRef = useRef<HTMLDivElement>(null);
  function handleScroll(e: React.UIEvent<HTMLDivElement>) { setActiveIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth)); }
  useEffect(() => { if (fullscreen && fsScrollRef.current) fsScrollRef.current.scrollTo({ left: activeIdx * fsScrollRef.current.clientWidth, behavior: 'instant' as ScrollBehavior }); }, [fullscreen, activeIdx]);
  useEffect(() => { setActiveIdx(0); if (scrollRef.current) scrollRef.current.scrollTo({ left: 0, behavior: 'instant' as ScrollBehavior }); }, [images]);
  if (!images || images.length === 0) return null;
  return (
    <>
      <div className="relative mb-3" data-dbg="photo-carousel">
        <div ref={scrollRef} onScroll={handleScroll} className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {images.map((img, i) => (
            <div key={img.id} className="w-full flex-shrink-0 snap-center px-4" onClick={() => { setActiveIdx(i); setFullscreen(true); }}>
              <div className="aspect-[16/10] rounded-2xl overflow-hidden bg-white/5 relative">
                <img src={`data:image/jpeg;base64,${img.image}`} alt={img.caption || `Photo ${i + 1}`} className="w-full h-full object-cover" />
                {img.caption && <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6"><div className="text-[13px] text-white/90">{img.caption}</div></div>}
                <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></div>
              </div>
            </div>
          ))}
        </div>
        {images.length > 1 && <div className="flex justify-center gap-1.5 mt-1.5">{images.map((_, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === activeIdx ? 'bg-white' : 'bg-white/25'}`} />)}</div>}
      </div>
      {fullscreen && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col">
          <div className="px-5 pt-14 pb-3 flex items-center gap-3">
            <button onClick={() => setFullscreen(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center active:bg-white/20"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            <div className="flex-1 text-center"><span className="text-[14px] font-bold text-white">{activeIdx + 1} / {images.length}</span></div>
            <div className="w-9" />
          </div>
          <div ref={fsScrollRef} onScroll={(e) => setActiveIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))} className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            {images.map((img, i) => <div key={img.id} className="w-full flex-shrink-0 snap-center flex items-center justify-center px-2"><img src={`data:image/jpeg;base64,${img.image}`} alt={img.caption || `Photo ${i + 1}`} className="max-w-full max-h-full object-contain rounded-xl" /></div>)}
          </div>
          <div className="px-5 py-4">
            {images[activeIdx]?.caption && <div className="text-[14px] text-white/80 text-center mb-2">{images[activeIdx].caption}</div>}
            {images.length > 1 && <div className="flex justify-center gap-1.5">{images.map((_, i) => <div key={i} className={`w-2 h-2 rounded-full ${i === activeIdx ? 'bg-white' : 'bg-white/25'}`} />)}</div>}
          </div>
        </div>
      )}
    </>
  );
}

interface Props {
  session: CookingSession;
  onUpdateSession: (id: string, updates: Partial<CookingSession>) => void;
  onDashboard: () => void;
  onComplete: (sessionId: string, elapsed: number) => void;
  onEndSession: (sessionId: string) => void;
  sessionCount: number;
}

export default function CookMode({ session, onUpdateSession, onDashboard, onComplete, onEndSession, sessionCount }: Props) {
  const [now, setNow] = useState(Date.now());
  const [flashing, setFlashing] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showPrevConfirm, setShowPrevConfirm] = useState(false);
  const prevDoneRef = useRef(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(iv);
  }, []);

  const step = session.steps[session.currentStep];
  const timer = computeTimer(session, now);
  const hasTimer = step && step.timer_seconds > 0;
  const isLastStep = session.currentStep >= session.steps.length - 1;

  const triggerLocalAlert = useCallback(() => {
    try {
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const o = ac.createOscillator(); const g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; o.type = 'square'; g.gain.value = 0.3;
      o.start(); o.stop(ac.currentTime + 0.5);
    } catch (_e) { /* */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setFlashing(true); setTimeout(() => setFlashing(false), 1000);
  }, []);

  useEffect(() => {
    if (timer.done && !prevDoneRef.current) triggerLocalAlert();
    prevDoneRef.current = timer.done;
  }, [timer.done, triggerLocalAlert]);

  function startTimer() {
    if (!step) return;
    onUpdateSession(session.id, { timerEndAt: Date.now() + step.timer_seconds * 1000, timerTotal: step.timer_seconds, timerPausedLeft: null });
  }
  function pauseTimer() {
    if (!session.timerEndAt) return;
    const left = Math.max(0, Math.ceil((session.timerEndAt - Date.now()) / 1000));
    onUpdateSession(session.id, { timerEndAt: null, timerPausedLeft: left });
  }
  function resumeTimer() {
    if (!session.timerPausedLeft) return;
    onUpdateSession(session.id, { timerEndAt: Date.now() + session.timerPausedLeft * 1000, timerPausedLeft: null });
  }
  function skipTimer() { onUpdateSession(session.id, { timerEndAt: null, timerTotal: 0, timerPausedLeft: null }); nextStep(); }
  function addTime(sec: number) {
    if (session.timerEndAt) onUpdateSession(session.id, { timerEndAt: session.timerEndAt + sec * 1000, timerTotal: session.timerTotal + sec });
  }
  function snooze(sec: number) {
    onUpdateSession(session.id, { timerEndAt: Date.now() + sec * 1000, timerTotal: sec, timerPausedLeft: null });
  }
  function nextStep() {
    if (isLastStep) {
      onUpdateSession(session.id, { showPlating: true, timerEndAt: null, timerTotal: 0, timerPausedLeft: null });
    } else {
      onUpdateSession(session.id, { currentStep: session.currentStep + 1, timerEndAt: null, timerTotal: 0, timerPausedLeft: null });
    }
  }
  function prevStep() {
    if (session.currentStep <= 0) return;
    if (timer.running || (timer.active && !timer.done)) {
      setShowPrevConfirm(true);
      return;
    }
    doPrevStep();
  }
  function doPrevStep() {
    onUpdateSession(session.id, { currentStep: session.currentStep - 1, timerEndAt: null, timerTotal: 0, timerPausedLeft: null, showPlating: false });
  }
  function handleComplete() {
    onComplete(session.id, Math.round((Date.now() - session.startedAt) / 1000));
  }

  function getTimerColor(): string {
    if (timer.done) return '#ef4444';
    if (timer.total === 0) return '#22c55e';
    const pct = timer.left / timer.total;
    return pct > 0.5 ? '#22c55e' : pct > 0.2 ? '#f59e0b' : '#ef4444';
  }

  const circumference = 2 * Math.PI * 45;
  const ringOffset = timer.total > 0 ? circumference * (1 - timer.left / timer.total) : 0;

  // ===== PLATING =====
  if (session.showPlating) {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col">
        <div className="px-4 pt-12 pb-2 flex items-center gap-2">
          {/* Back to last cook step */}
          <button onClick={() => onUpdateSession(session.id, { showPlating: false })} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <div className="text-[18px] font-bold text-white">Plating</div>
            <div className="text-[11px] text-white/30 truncate">{session.recipeName}</div>
          </div>
          {/* Dashboard button — top right */}
          <button onClick={onDashboard} className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center active:bg-amber-500/30 relative flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            {sessionCount > 1 && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                <span className="text-[9px] font-bold text-black">{sessionCount}</span>
              </div>
            )}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center">
            <div className="text-7xl mb-6">{'\ud83c\udf7d\ufe0f'}</div>
            <div className="text-[22px] font-bold text-white mb-4">{session.recipeName}</div>
            <p className="text-[15px] text-white/60 leading-relaxed">
              {session.mode === 'cooking' ? 'Plate the dish according to SSAM standards.' : 'Portion into containers. Label with date, batch #, and use-by.'}
            </p>
          </div>
        </div>
        <div className="px-5 py-6 space-y-2">
          <button onClick={handleComplete} className="w-full py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg">{'\u2713'} Dish complete</button>
          <button onClick={() => setShowEndConfirm(true)}
            className="w-full py-2 text-[12px] text-red-400/50 font-medium active:text-red-400">{'\u00d7'} End session</button>
          {showEndConfirm && (
            <ConfirmDialog
              title={`End ${session.recipeName}?`}
              message="This will cancel the cooking session. Progress will be lost."
              confirmLabel="End session"
              cancelLabel="Keep cooking"
              variant="danger"
              onConfirm={() => { setShowEndConfirm(false); onEndSession(session.id); }}
              onCancel={() => setShowEndConfirm(false)}
            />
          )}
        </div>
      </div>
    );
  }

  if (!step) return null;
  const bullets = parseInstructions(step.instruction);
  const stepImages = step.images || [];
  const typeBadge = TYPE_COLOR[step.step_type] || 'bg-white/10 text-white/60';
  const typeLabel = TYPE_LABEL[step.step_type] || step.step_type.toUpperCase();

  return (
    <div className={`min-h-screen bg-[#0a0a0a] flex flex-col ${flashing ? 'animate-pulse bg-red-900' : ''}`}>
      {/* HEADER: Back left, Step info center, Dashboard right */}
      <div className="px-4 pt-12 pb-1 flex items-center gap-1.5">
        {/* Previous step button — only from step 2 onward */}
        {session.currentStep > 0 && (
          <button onClick={prevStep} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center active:bg-white/20 flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-white">Step {session.currentStep + 1}<span className="text-white/30 font-normal">/{session.steps.length}</span></span>
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${typeBadge}`}>{typeLabel}</span>
            {hasTimer && !timer.active && <span className="text-[11px] text-white/30 font-mono">{'\u23f1'} {formatTimer(step.timer_seconds)}</span>}
          </div>
          <div className="text-[11px] text-white/30 truncate">{session.recipeName}</div>
        </div>
        {/* Dashboard button — top right corner */}
        <button onClick={onDashboard} className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center active:bg-amber-500/30 relative flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          {sessionCount > 1 && (
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
              <span className="text-[9px] font-bold text-black">{sessionCount}</span>
            </div>
          )}
        </button>
      </div>

      {/* PROGRESS BAR */}
      <div className="flex items-center gap-1 px-4 py-1.5">
        {session.steps.map((_, i) => (
          <div key={i} className={`h-[3px] rounded-full flex-1 transition-colors ${i < session.currentStep ? 'bg-green-500' : i === session.currentStep ? (session.mode === 'cooking' ? 'bg-green-400' : 'bg-purple-400') : 'bg-white/10'}`} />
        ))}
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className="flex-1 overflow-y-auto pb-4">
        <PhotoCarousel images={stepImages} />
        {step.ingredients && step.ingredients.length > 0 && (
          <div className="px-4 mb-3"><div className="flex flex-wrap gap-1.5">{step.ingredients.map(ing => (
            <div key={ing.id} className="px-2.5 py-1 rounded-lg bg-white/8 border border-white/10 text-[13px] text-white/80">{ing.uom && <span className="font-mono text-white/40 mr-1">{ing.uom}</span>}{ing.name}</div>
          ))}</div></div>
        )}
        <div className="px-4" data-dbg="instruction-box">
          {bullets.length > 0 ? (
            <div className="space-y-3">{bullets.map((bullet, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-white/8 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-[12px] font-bold text-white/40 font-mono">{i + 1}</span></div>
                <div className="text-[20px] text-white/90 leading-[1.45] flex-1">{renderBulletText(bullet)}</div>
              </div>
            ))}</div>
          ) : (
            <div className="text-[20px] text-white/90 leading-[1.45]">{step.instruction?.replace(/<[^>]*>/g, '') || `Step ${session.currentStep + 1}`}</div>
          )}
        </div>
        {step.tip && <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/15"><div className="text-[14px] text-amber-300/90 leading-snug">{'\ud83d\udca1'} {step.tip}</div></div>}
      </div>

      {/* FIXED BOTTOM: Timer + Actions — always visible */}
      <div className="flex-shrink-0 border-t border-white/10 bg-[#0a0a0a] px-4 pb-4 pt-3">
        {hasTimer && timer.active && (
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="relative flex-shrink-0">
              <svg width="72" height="72" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle cx="50" cy="50" r="45" fill="none" stroke={getTimerColor()} strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={ringOffset} style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.5s, stroke 0.5s' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[18px] font-bold font-mono ${timer.done ? 'text-red-500' : 'text-white'}`}>{timer.done ? `+${formatTimer(timer.overdue)}` : formatTimer(timer.left)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {timer.done && <div className="text-[12px] font-bold text-red-400 uppercase tracking-wider">OVERDUE</div>}
              {timer.running && <div className="flex gap-1.5"><button onClick={() => addTime(30)} className="px-3 py-1 rounded-lg bg-white/8 text-[12px] text-white/60 active:bg-white/15">+30s</button><button onClick={() => addTime(60)} className="px-3 py-1 rounded-lg bg-white/8 text-[12px] text-white/60 active:bg-white/15">+1m</button></div>}
              {timer.done && <div className="flex gap-1.5"><button onClick={() => snooze(60)} className="px-2.5 py-1 rounded-lg bg-white/8 text-[12px] text-white/70 font-semibold active:bg-white/15">+1 min</button><button onClick={() => snooze(120)} className="px-2.5 py-1 rounded-lg bg-white/8 text-[12px] text-white/70 font-semibold active:bg-white/15">+2 min</button></div>}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          {hasTimer && !timer.active && (<><button onClick={startTimer} className="w-full py-3.5 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">{'\u25b6'}  Start timer ({formatTimer(step.timer_seconds)})</button><button onClick={skipTimer} className="w-full py-1.5 text-[12px] text-white/40 font-medium active:text-white/60">Skip timer {'\u2192'} next step</button></>)}
          {hasTimer && timer.running && (<><button onClick={pauseTimer} className="w-full py-3.5 rounded-2xl text-[16px] font-bold text-white bg-amber-600 active:bg-amber-700">{'\u23f8'}  Pause</button><button onClick={skipTimer} className="w-full py-1.5 text-[12px] text-white/40 font-medium active:text-white/60">Skip timer {'\u2192'} next step</button></>)}
          {hasTimer && !timer.running && timer.active && !timer.done && (<><button onClick={resumeTimer} className="w-full py-3.5 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700">{'\u25b6'}  Resume</button><button onClick={skipTimer} className="w-full py-1.5 text-[12px] text-white/40 font-medium active:text-white/60">Skip timer {'\u2192'} next step</button></>)}
          {hasTimer && timer.done && <button onClick={nextStep} className="w-full py-3.5 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg">{isLastStep ? 'Done \u2192 Plating' : 'Done \u2192 Next step'}</button>}
          {!hasTimer && <button onClick={nextStep} className="w-full py-3.5 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg">{isLastStep ? 'Done \u2192 Plating' : 'Done \u2192 Next step'}</button>}
        </div>
      </div>
      {showPrevConfirm && (
        <ConfirmDialog
          title="Go back a step?"
          message="The current timer will be reset. You can restart it when you return."
          confirmLabel="Go back"
          cancelLabel="Stay here"
          variant="primary"
          onConfirm={() => { setShowPrevConfirm(false); doPrevStep(); }}
          onCancel={() => setShowPrevConfirm(false)}
        />
      )}
    </div>
  );
}
