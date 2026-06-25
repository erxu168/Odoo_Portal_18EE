'use client';

/**
 * Kitchen timer + stopwatch state for the KDS.
 * Lives above the panel so countdowns keep running (and alarm) even when the
 * panel is closed. Uses wall-clock timestamps so it stays accurate without
 * re-rendering the whole board every tick.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { playTimerAlarm } from './soundEngine';

const STORAGE_KEY = 'kds_timer_state_v1';

/** Format a number of seconds as M:SS or H:MM:SS. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface KitchenTimer {
  id: number;
  label: string;
  totalSec: number;
  endsAt: number | null;   // ms timestamp while running; null when paused/finished
  remainingSec: number;    // authoritative while paused
  finished: boolean;
}

export interface StopwatchState {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

interface TimersContextType {
  timers: KitchenTimer[];
  stopwatch: StopwatchState;
  panelOpen: boolean;
  activeCount: number;
  anyFinished: boolean;
  openPanel: () => void;
  closePanel: () => void;
  addTimer: (minutes: number, label?: string) => void;
  pauseTimer: (id: number) => void;
  resumeTimer: (id: number) => void;
  removeTimer: (id: number) => void;
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
}

const TimersContext = createContext<TimersContextType | null>(null);

export function useTimers(): TimersContextType {
  const ctx = useContext(TimersContext);
  if (!ctx) throw new Error('useTimers must be used within TimerProvider');
  return ctx;
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timers, setTimers] = useState<KitchenTimer[]>([]);
  const [stopwatch, setStopwatch] = useState<StopwatchState>({ running: false, startedAt: null, accumulatedMs: 0 });
  const [panelOpen, setPanelOpen] = useState(false);
  const nextId = useRef(1);
  const timersRef = useRef<KitchenTimer[]>([]);
  timersRef.current = timers;
  const firstSave = useRef(true);

  // Restore persisted timers/stopwatch on mount (survives a page reload).
  // State is timestamp-based, so running timers/stopwatch resume at the correct time.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { timers?: KitchenTimer[]; stopwatch?: StopwatchState };
      const now = Date.now();
      if (Array.isArray(data.timers)) {
        const loaded = data.timers.map(t =>
          (t.endsAt !== null && !t.finished && t.endsAt - now <= 0)
            ? { ...t, endsAt: null, remainingSec: 0, finished: true }
            : t
        );
        setTimers(loaded);
        nextId.current = loaded.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      }
      if (data.stopwatch) setStopwatch(data.stopwatch);
    } catch { /* ignore corrupt/unavailable storage */ }
  }, []);

  // Persist on change (skip the first run so we don't clobber what we just loaded).
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ timers, stopwatch }));
    } catch { /* ignore */ }
  }, [timers, stopwatch]);

  // Watch for finished countdowns and alarm — runs regardless of panel state.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cur = timersRef.current;
      const justDone = cur.some(t => t.endsAt !== null && !t.finished && t.endsAt - now <= 0);
      if (!justDone) return;
      setTimers(prev => prev.map(t =>
        (t.endsAt !== null && !t.finished && t.endsAt - now <= 0)
          ? { ...t, remainingSec: 0, endsAt: null, finished: true }
          : t
      ));
      playTimerAlarm(0.9);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const addTimer = useCallback((minutes: number, label?: string) => {
    if (!minutes || minutes <= 0) return;
    const sec = Math.max(1, Math.round(minutes * 60));
    setTimers(prev => [...prev, {
      id: nextId.current++,
      label: (label || '').trim(),
      totalSec: sec,
      endsAt: Date.now() + sec * 1000,
      remainingSec: sec,
      finished: false,
    }]);
  }, []);

  const pauseTimer = useCallback((id: number) => {
    setTimers(prev => prev.map(t => {
      if (t.id !== id || t.endsAt === null || t.finished) return t;
      return { ...t, remainingSec: Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)), endsAt: null };
    }));
  }, []);

  const resumeTimer = useCallback((id: number) => {
    setTimers(prev => prev.map(t => {
      if (t.id !== id || t.endsAt !== null || t.finished) return t;
      return { ...t, endsAt: Date.now() + t.remainingSec * 1000 };
    }));
  }, []);

  const removeTimer = useCallback((id: number) => {
    setTimers(prev => prev.filter(t => t.id !== id));
  }, []);

  const startStopwatch = useCallback(() => {
    setStopwatch(s => s.running ? s : { ...s, running: true, startedAt: Date.now() });
  }, []);
  const pauseStopwatch = useCallback(() => {
    setStopwatch(s => (!s.running || s.startedAt === null)
      ? s
      : { running: false, startedAt: null, accumulatedMs: s.accumulatedMs + (Date.now() - s.startedAt) });
  }, []);
  const resetStopwatch = useCallback(() => setStopwatch({ running: false, startedAt: null, accumulatedMs: 0 }), []);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const activeCount = timers.filter(t => !t.finished).length;
  const anyFinished = timers.some(t => t.finished);

  const value: TimersContextType = {
    timers, stopwatch, panelOpen, activeCount, anyFinished,
    openPanel, closePanel, addTimer, pauseTimer, resumeTimer, removeTimer,
    startStopwatch, pauseStopwatch, resetStopwatch,
  };

  return <TimersContext.Provider value={value}>{children}</TimersContext.Provider>;
}
