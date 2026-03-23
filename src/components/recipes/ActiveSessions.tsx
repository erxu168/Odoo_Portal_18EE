'use client';

import React, { useState, useEffect } from 'react';
import { type CookingSession, computeTimer, formatTimer } from '@/lib/cooking-sessions';

const TYPE_LABEL: Record<string, string> = { prep: 'PREP', cook: 'COOK', plate: 'PLATE' };
const TYPE_COLOR: Record<string, string> = {
  prep: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  cook: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  plate: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

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

  function cardStyle(s: CookingSession): string {
    const t = computeTimer(s, now);
    if (t.done) return 'border-red-500 bg-red-500/5';
    if (t.running && t.left < 60) return 'border-amber-500 bg-amber-500/5';
    if (t.running) return 'border-green-500/50 bg-green-500/5';
    return 'border-white/10 bg-white/5';
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <div className="px-4 pt-12 pb-2 flex items-center gap-2">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
        </button>
        <div className="flex-1">
          <div className="text-[17px] font-bold text-white">Active sessions</div>
          <div className="text-[11px] text-white/40">{active.length} {active.length === 1 ? 'dish' : 'dishes'} cooking</div>
        </div>
        <button onClick={onHome} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
        </button>
      </div>

      <div className="flex-1 px-4 pt-3 pb-6 overflow-y-auto">
        {active.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">{"\ud83c\udf73"}</div>
            <div className="text-[16px] font-bold text-white/80 mb-2">No active sessions</div>
            <div className="text-[13px] text-white/40 mb-6">Start cooking a dish to see it here</div>
            <button onClick={onNewDish} className="px-6 py-3 rounded-2xl bg-green-600 text-white font-bold text-[15px] active:bg-green-700">Start cooking</button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {active.map((session, idx) => {
            const timer = computeTimer(session, now);
            const step = session.steps[session.currentStep];
            const stepType = step?.step_type || 'prep';
            const typeBadge = TYPE_COLOR[stepType] || 'bg-white/10 text-white/50 border-white/20';
            const typeLabel = TYPE_LABEL[stepType] || stepType.toUpperCase();

            return (
              <div key={session.id} className={`rounded-2xl border-2 overflow-hidden transition-colors ${cardStyle(session)}`}>
                <button onClick={() => onSelectSession(session.id)} className="w-full text-left p-4 active:opacity-80">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[16px] font-bold font-mono ${
                      session.mode === 'cooking' ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] font-bold text-white mb-0.5 truncate">{session.recipeName}</div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] text-white/50">{session.showPlating ? 'Plating' : `Step ${session.currentStep + 1}/${session.steps.length}`}</span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${typeBadge}`}>{typeLabel}</span>
                      </div>
                      {timer.done && (
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[15px] font-bold text-red-400 font-mono">+{formatTimer(timer.overdue)}</span>
                          <span className="text-[11px] font-bold text-red-400 uppercase">overdue</span>
                        </div>
                      )}
                      {timer.running && (
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${timer.left < 60 ? 'bg-amber-500' : 'bg-green-500'} animate-pulse`} />
                          <span className={`text-[15px] font-bold font-mono ${timer.left < 60 ? 'text-amber-400' : 'text-green-400'}`}>{formatTimer(timer.left)}</span>
                          <span className="text-[11px] text-white/30">remaining</span>
                        </div>
                      )}
                      {timer.active && !timer.running && !timer.done && (
                        <div className="text-[13px] text-white/40">{"\u23f8"} Paused at {formatTimer(timer.left)}</div>
                      )}
                      {!timer.active && step && step.timer_seconds > 0 && (
                        <div className="text-[13px] text-white/30">{"\u23f1"} Timer: {formatTimer(step.timer_seconds)} (not started)</div>
                      )}
                      {!timer.active && (!step || step.timer_seconds === 0) && (
                        <div className="text-[13px] text-white/30">Waiting for you</div>
                      )}
                    </div>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" className="flex-shrink-0 mt-2"><path d="M9 18l6-6-6-6"/></svg>
                  </div>
                </button>
                <div className="px-4 pb-3 flex justify-end">
                  <button onClick={() => { if (confirm(`End ${session.recipeName}?`)) onEndSession(session.id); }}
                    className="text-[11px] text-red-400/50 font-medium active:text-red-400">End session</button>
                </div>
              </div>
            );
          })}
        </div>

        {active.length > 0 && (
          <button onClick={onNewDish}
            className="w-full mt-4 py-4 rounded-2xl border-2 border-dashed border-white/15 flex items-center justify-center gap-2 active:bg-white/5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            <span className="text-[15px] font-semibold text-white/40">Start another dish</span>
          </button>
        )}
      </div>
    </div>
  );
}
