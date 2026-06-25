'use client';

import { useState, useEffect } from 'react';
import { useKds } from '@/lib/kds/state';
import { useTimers, formatDuration } from '@/lib/kds/timers';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function KdsTopbar() {
  const { muted, toggleMute, openSettings, mode, setMode } = useKds();
  const { openPanel, activeCount, anyFinished, timers, stopwatch } = useTimers();
  const [time, setTime] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    function tick() {
      const now = new Date();
      setNowMs(now.getTime());
      setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Live stopwatch readout for the top bar.
  const swElapsedSec = Math.floor(
    (stopwatch.accumulatedMs + (stopwatch.running && stopwatch.startedAt ? nowMs - stopwatch.startedAt : 0)) / 1000
  );
  const swActive = stopwatch.running || stopwatch.accumulatedMs > 0;

  // Nearest running countdown.
  let nearestSec: number | null = null;
  for (const t of timers) {
    if (t.finished || t.endsAt === null) continue;
    const rem = Math.max(0, Math.round((t.endsAt - nowMs) / 1000));
    if (nearestSec === null || rem < nearestSec) nearestSec = rem;
  }

  return (
    <div className="kds-topbar">
      <div className="kds-logo">
        KRAWINGS KDS <span>What a Jerk</span>
      </div>
      <div className="kds-topbar-right">
        <button
          className="kds-topbar-btn"
          onClick={() => setMode(mode === 'smart' ? 'classic' : 'smart')}
          aria-label={mode === 'smart' ? 'Switch to one-card-per-order view' : 'Switch to grouped-by-dish view'}
          style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.3px' }}
        >
          {mode === 'smart' ? 'By order ⇄' : 'By dish ⇄'}
        </button>
        <button
          className={`kds-topbar-btn ${muted ? 'is-muted' : ''}`}
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {muted ? (
              <>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            ) : (
              <>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </>
            )}
          </svg>
        </button>
        <button className="kds-topbar-btn" onClick={openSettings} aria-label="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {swActive && (
          <button className="kds-live-chip kds-live-sw" onClick={openPanel} aria-label="Stopwatch">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="13" r="8" /><path d="M12 13V9" /><path d="M9 2h6" />
            </svg>
            {formatDuration(swElapsedSec)}
          </button>
        )}
        {nearestSec !== null && (
          <button className={`kds-live-chip kds-live-timer ${nearestSec <= 30 ? 'urgent' : ''}`} onClick={openPanel} aria-label="Timer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="13" r="8" /><path d="M12 13l3 2" /><path d="M9 2h6" />
            </svg>
            {formatDuration(nearestSec)}
          </button>
        )}

        <button
          className={`kds-topbar-btn kds-timer-open ${anyFinished ? 'is-finished' : ''}`}
          onClick={openPanel}
          aria-label="Timers"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 13V9" />
            <path d="M9 2h6" />
            <path d="M12 5V2" />
          </svg>
          {activeCount > 0 && <span className="kds-timer-badge">{activeCount}</span>}
        </button>
        <span className="kds-clock">{time}</span>
      </div>
    </div>
  );
}
