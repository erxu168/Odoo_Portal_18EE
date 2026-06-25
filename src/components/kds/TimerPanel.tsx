'use client';

import { useState, useEffect } from 'react';
import { useTimers } from '@/lib/kds/timers';
import type { KitchenTimer } from '@/lib/kds/timers';

const PRESETS = [1, 3, 5, 10];

function fmt(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TimerPanel() {
  const {
    panelOpen, closePanel, timers, addTimer, pauseTimer, resumeTimer, removeTimer,
    stopwatch, startStopwatch, pauseStopwatch, resetStopwatch,
  } = useTimers();
  const [tab, setTab] = useState<'countdown' | 'stopwatch'>('countdown');
  const [customMin, setCustomMin] = useState('');
  const [label, setLabel] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Tick for display only while the panel is open.
  useEffect(() => {
    if (!panelOpen) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [panelOpen]);

  if (!panelOpen) return null;

  const remainingOf = (t: KitchenTimer): number =>
    t.endsAt !== null ? Math.max(0, Math.round((t.endsAt - now) / 1000)) : t.remainingSec;

  const swElapsed = Math.floor(
    (stopwatch.accumulatedMs + (stopwatch.running && stopwatch.startedAt ? now - stopwatch.startedAt : 0)) / 1000
  );

  function handleAdd(minutes: number) {
    addTimer(minutes, label);
    setLabel('');
    setCustomMin('');
  }

  return (
    <div className="kds-timer-overlay" onClick={closePanel}>
      <div className="kds-timer-panel" onClick={e => e.stopPropagation()}>
        <div className="kds-timer-head">
          <span className="kds-timer-title">Timer</span>
          <button className="kds-timer-close" onClick={closePanel} aria-label="Close">{'✕'}</button>
        </div>

        <div className="kds-timer-tabs">
          <button className={`kds-timer-tab ${tab === 'countdown' ? 'active' : ''}`} onClick={() => setTab('countdown')}>Countdown</button>
          <button className={`kds-timer-tab ${tab === 'stopwatch' ? 'active' : ''}`} onClick={() => setTab('stopwatch')}>Stopwatch</button>
        </div>

        {tab === 'countdown' ? (
          <div className="kds-timer-body">
            <div className="kds-timer-presets">
              {PRESETS.map(m => (
                <button key={m} className="kds-timer-preset" onClick={() => handleAdd(m)}>{m} min</button>
              ))}
            </div>
            <div className="kds-timer-custom">
              <input
                className="kds-timer-input"
                type="text"
                placeholder="Label (optional)"
                value={label}
                onChange={e => setLabel(e.target.value)}
              />
              <input
                className="kds-timer-input kds-timer-min"
                type="number"
                min="1"
                placeholder="min"
                value={customMin}
                onChange={e => setCustomMin(e.target.value)}
              />
              <button className="kds-timer-start" onClick={() => handleAdd(Number(customMin))}>Start</button>
            </div>

            <div className="kds-timer-list">
              {timers.length === 0 && <div className="kds-timer-empty">No timers running</div>}
              {timers.map(t => {
                const running = t.endsAt !== null && !t.finished;
                return (
                  <div key={t.id} className={`kds-timer-row ${t.finished ? 'finished' : ''}`}>
                    <div className="kds-timer-row-info">
                      {t.label && <span className="kds-timer-row-label">{t.label}</span>}
                      <span className="kds-timer-row-time">{t.finished ? 'DONE' : fmt(remainingOf(t))}</span>
                    </div>
                    <div className="kds-timer-row-actions">
                      {!t.finished && (running ? (
                        <button className="kds-timer-btn" onClick={() => pauseTimer(t.id)} aria-label="Pause">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                        </button>
                      ) : (
                        <button className="kds-timer-btn" onClick={() => resumeTimer(t.id)} aria-label="Resume">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        </button>
                      ))}
                      <button className="kds-timer-btn kds-timer-btn-x" onClick={() => removeTimer(t.id)} aria-label="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="kds-timer-body">
            <div className="kds-stopwatch-time">{fmt(swElapsed)}</div>
            <div className="kds-stopwatch-actions">
              {!stopwatch.running ? (
                <button className="kds-timer-start" onClick={startStopwatch}>Start</button>
              ) : (
                <button className="kds-timer-start kds-timer-pause" onClick={pauseStopwatch}>Pause</button>
              )}
              <button className="kds-timer-reset" onClick={resetStopwatch}>Reset</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
