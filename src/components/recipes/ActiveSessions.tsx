'use client';

import React, { useState, useEffect } from 'react';
import { type CookingSession, computeTimer, formatTimer } from '@/lib/cooking-sessions';

interface Props {
  sessions: CookingSession[];
  onSelectSession: (id: string) => void;
  onNewDish: () => void;
  onBack: () => void;
  onHome: () => void;
  onEndSession: (id: string) => void;
}

export default function ActiveSessions({ sessions, onSelectSession, onNewDish, onBack, onHome, onEndSession }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);

  const active = sessions.filter(s => s.status === 'active');

  // Sort: overdue first, then running (least time left first), then waiting
  const sorted = [...active].sort((a, b) => {
    const ta = computeTimer(a, now);
    const tb = computeTimer(b, now);
    if (ta.done && !tb.done) return -1;
    if (!ta.done && tb.done) return 1;
    if (ta.running && !tb.running) return -1;
    if (!ta.running && tb.running) return 1;
    if (ta.running && tb.running) return ta.left - tb.left;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="px-4 pt-12 pb-1 flex items-center gap-2">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
        </button>
        <div className="flex-1">
          <div className="text-[17px] font-bold text-white">Kitchen board</div>
          <div className="text-[11px] text-white/40">{active.length}/10 dishes active</div>
        </div>
        <button onClick={onHome} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
        </button>
      </div>

      {/* Grid of session cards */}
      <div className="flex-1 px-3 pt-3 pb-6 overflow-y-auto">
        {active.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">{'\ud83c\udf73'}</div>
            <div className="text-[16px] font-bold text-white/80 mb-2">Kitchen is quiet</div>
            <div className="text-[13px] text-white/40 mb-6">Start cooking to see dishes here</div>
            <button onClick={onNewDish} className="px-6 py-3 rounded-2xl bg-green-600 text-white font-bold text-[15px] active:bg-green-700">{'\u002b'} Start cooking</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {sorted.map((session) => {
            const timer = computeTimer(session, now);
            const step = session.steps[session.currentStep];
            const isOverdue = timer.done;
            const isUrgent = timer.running && timer.left < 60;

            let borderColor = 'border-white/10';
            let bg = 'bg-white/[0.03]';
            if (isOverdue) { borderColor = 'border-red-500'; bg = 'bg-red-500/10'; }
            else if (isUrgent) { borderColor = 'border-amber-500'; bg = 'bg-amber-500/5'; }
            else if (timer.running) { borderColor = 'border-green-500/40'; bg = 'bg-green-500/5'; }

            return (
              <button key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`relative rounded-2xl border-2 ${borderColor} ${bg} p-3 text-left active:opacity-80 transition-colors overflow-hidden`}>

                {/* Pulsing dot for running/overdue */}
                {(timer.running || isOverdue) && (
                  <div className={`absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full animate-pulse ${isOverdue ? 'bg-red-500' : isUrgent ? 'bg-amber-500' : 'bg-green-500'}`} />
                )}

                {/* Dish name */}
                <div className="text-[14px] font-bold text-white truncate pr-4 mb-1">{session.recipeName}</div>

                {/* Step info */}
                <div className="text-[11px] text-white/40 mb-2">
                  {session.showPlating ? 'Plating' : `Step ${session.currentStep + 1}/${session.steps.length}`}
                  {step && <span className="ml-1 capitalize">{`\u00b7 ${step.step_type}`}</span>}
                </div>

                {/* Timer display — big and prominent */}
                {isOverdue && (
                  <div className="text-[24px] font-bold text-red-400 font-mono leading-none">+{formatTimer(timer.overdue)}</div>
                )}
                {timer.running && !isOverdue && (
                  <div className={`text-[24px] font-bold font-mono leading-none ${isUrgent ? 'text-amber-400' : 'text-green-400'}`}>{formatTimer(timer.left)}</div>
                )}
                {timer.active && !timer.running && !isOverdue && (
                  <div className="text-[18px] text-white/30 font-mono leading-none">{'\u23f8'} {formatTimer(timer.left)}</div>
                )}
                {!timer.active && step && step.timer_seconds > 0 && (
                  <div className="text-[14px] text-white/20 font-mono">{'\u23f1'} {formatTimer(step.timer_seconds)}</div>
                )}
                {!timer.active && (!step || step.timer_seconds === 0) && (
                  <div className="text-[13px] text-white/20">Ready</div>
                )}

                {/* End session — small, bottom corner */}
                <div className="mt-2 flex justify-end" onClick={(e) => { e.stopPropagation(); if (confirm(`End ${session.recipeName}?`)) onEndSession(session.id); }}>
                  <span className="text-[10px] text-red-400/40 active:text-red-400">{'\u00d7'} end</span>
                </div>
              </button>
            );
          })}

          {/* + New dish card */}
          {active.length < 10 && (
            <button onClick={onNewDish}
              className="rounded-2xl border-2 border-dashed border-white/10 p-3 flex flex-col items-center justify-center min-h-[130px] active:bg-white/5 transition-colors">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div className="text-[13px] font-semibold text-white/30">New dish</div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
