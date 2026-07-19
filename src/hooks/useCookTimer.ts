'use client';

/**
 * useCookTimer — the Cooking Timer station screen's client engine.
 *
 * - Polls /api/cooktimer/timers + /queue (~1.2s) so a second tablet on the same
 *   station and a reloaded tablet both converge on server truth.
 * - Ticks locally at 250ms to render countdowns from step_started_at (corrected
 *   for tablet clock skew via serverNow) and to drive the repeating alarm sound.
 * - Applies short-lived optimistic overrides so taps feel instant, then lets the
 *   server reconcile.
 * - Per-tablet station selection + global sound live in localStorage.
 *
 * Audio is fire-and-forget and only ever fired AFTER state is set (spec dec. 12).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CookStation, CookTimerDTO, QueueGroup, DoneEntry } from '@/types/cooktimer';
import { deriveDisplayState } from '@/lib/cooktimer-logic';
import { unlockAudio, playStageAlarm, playDoneAlarm } from '@/lib/cooktimer/sound';

const LS_STATIONS = 'ct_enabled_stations';
const LS_SOUND = 'ct_sound_on';
const POLL_MS = 1200;
const TICK_MS = 250;
const BEEP_MS = 1600;

interface Override { currentStep?: number; stepStartedEpoch?: number; muted?: boolean; removed?: boolean; expires: number; }

function readEnabled(): number[] | null {
  try { const raw = localStorage.getItem(LS_STATIONS); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  return null; // null = not chosen yet -> default to all on first load
}
function readSound(): boolean {
  try { return localStorage.getItem(LS_SOUND) !== '0'; } catch { return true; }
}

export function useCookTimer() {
  const [stations, setStations] = useState<CookStation[]>([]);
  const [enabled, setEnabled] = useState<number[] | null>(() => (typeof window === 'undefined' ? null : readEnabled()));
  const [soundOn, setSoundOn] = useState<boolean>(() => (typeof window === 'undefined' ? true : readSound()));
  const [serverTimers, setServerTimers] = useState<CookTimerDTO[]>([]);
  const [queue, setQueue] = useState<QueueGroup[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overrides = useRef<Map<number, Override>>(new Map());
  const clockOffset = useRef(0);
  const lastBeep = useRef<Map<number, number>>(new Map());
  const soundRef = useRef(soundOn);
  const enabledRef = useRef(enabled);
  const serverTimersRef = useRef<CookTimerDTO[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { serverTimersRef.current = serverTimers; }, [serverTimers]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // --- merge helpers -------------------------------------------------------
  const mergeOne = useCallback((t: CookTimerDTO): CookTimerDTO | null => {
    const o = overrides.current.get(t.id);
    if (!o || o.expires < Date.now()) return t;
    if (o.removed) return null; // optimistically hidden (finish/cancel in flight)
    return {
      ...t,
      currentStep: o.currentStep ?? t.currentStep,
      stepStartedEpoch: o.stepStartedEpoch ?? t.stepStartedEpoch,
      muted: o.muted ?? t.muted,
    };
  }, []);

  const enabledSet = useCallback((): Set<number> | null => {
    const e = enabledRef.current;
    if (e === null) return null; // all
    return new Set(e);
  }, []);

  // --- polling -------------------------------------------------------------
  const pollTimers = useCallback(async () => {
    try {
      const res = await fetch('/api/cooktimer/timers', { cache: 'no-store' });
      const data = await res.json();
      if (typeof data.serverNow === 'number') clockOffset.current = data.serverNow - Date.now();
      if (Array.isArray(data.stations)) setStations(data.stations);
      if (Array.isArray(data.done)) setDone(data.done);
      if (Array.isArray(data.timers)) {
        setServerTimers(data.timers);
        // Prune overrides the server has caught up to (snappy handoff to truth).
        const byId = new Map<number, CookTimerDTO>(data.timers.map((t: CookTimerDTO) => [t.id, t]));
        overrides.current.forEach((o, id) => {
          if (o.expires < Date.now()) { overrides.current.delete(id); return; }
          const s = byId.get(id);
          if (o.removed) { if (!s) overrides.current.delete(id); return; }
          if (!s) return;
          const caughtStep = o.currentStep === undefined || s.currentStep >= o.currentStep;
          const caughtMute = o.muted === undefined || s.muted === o.muted;
          if (caughtStep && caughtMute) overrides.current.delete(id);
        });
      }
      setError(null);
    } catch { /* offline — keep last known, visual countdown continues */ }
  }, []);

  const pollQueue = useCallback(async () => {
    try {
      const e = enabledRef.current;
      // Always send an explicit stations param: all-enabled sends every id,
      // all-disabled sends an empty list (=> show nothing).
      const qs = e === null ? '' : `?stations=${e.join(',')}`;
      const res = await fetch(`/api/cooktimer/queue${qs}`, { cache: 'no-store' });
      const data = await res.json();
      if (Array.isArray(data.stations)) {
        setStations(data.stations);
        // First run with no stored selection: default to all active stations.
        if (enabledRef.current === null && data.stations.length) {
          const all = data.stations.map((s: CookStation) => s.id);
          enabledRef.current = all;
          setEnabled(all);
        }
      }
      if (Array.isArray(data.queue)) setQueue(data.queue);
      if (data.error) setError(data.error); else setError(null);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    pollTimers();
    pollQueue();
    const iv = setInterval(() => { pollTimers(); pollQueue(); }, POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch the queue immediately when the station selection changes.
  useEffect(() => { pollQueue(); /* eslint-disable-next-line */ }, [enabled]);

  // --- local tick: countdown + repeating alarm sound -----------------------
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now() + clockOffset.current;
      setNowMs(now);
      // Alarm/done audio for shown timers only. State is already rendered from
      // serverTimers/overrides — this only ADDS sound, never gates rendering.
      if (!soundRef.current) return;
      const set = enabledSet();
      for (const raw of serverTimersRef.current) {
        const t = mergeOne(raw);
        if (!t) continue;
        if (set && !set.has(t.stationId)) continue;
        if (t.muted) continue;
        const step = t.steps[t.currentStep];
        if (!step) continue;
        const isLast = t.currentStep >= t.steps.length - 1;
        const display = deriveDisplayState(step, t.stepStartedEpoch, isLast, now);
        if (display !== 'alarm' && display !== 'done') continue;
        const last = lastBeep.current.get(t.id) || 0;
        if (now - last >= BEEP_MS) {
          lastBeep.current.set(t.id, now);
          if (display === 'done') playDoneAlarm(); else playStageAlarm();
        }
      }
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [mergeOne, enabledSet]);

  // --- actions -------------------------------------------------------------
  const setOverride = (id: number, patch: Omit<Override, 'expires'>, ttl = 2500) => {
    overrides.current.set(id, { ...patch, expires: Date.now() + ttl });
    setServerTimers(prev => [...prev]); // force a re-render to apply the override
  };

  const start = useCallback(async (lineIds: number[]) => {
    unlockAudio();
    try {
      const res = await fetch('/api/cooktimer/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_ids: lineIds }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Could not start'); }
      await Promise.all([pollTimers(), pollQueue()]);
    } catch { showToast('Network error'); }
  }, [pollTimers, pollQueue, showToast]);

  const advance = useCallback(async (id: number, expectedStep: number) => {
    unlockAudio();
    setOverride(id, { currentStep: expectedStep + 1, stepStartedEpoch: Date.now() + clockOffset.current, muted: false });
    lastBeep.current.delete(id);
    try {
      await fetch(`/api/cooktimer/timers/${id}/advance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_step: expectedStep, mode: 'ack' }),
      });
    } catch { /* reconcile on poll */ }
    pollTimers();
  }, [pollTimers]);

  const skip = advance; // SKIP advances the same way; the two-tap confirm is UI-side.

  const finish = useCallback(async (id: number, expectedStep: number, label: string) => {
    setOverride(id, { removed: true }, 3500);
    showToast(`Marked ready on KDS ✓ ${label}`);
    try {
      await fetch(`/api/cooktimer/timers/${id}/finish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_step: expectedStep }),
      });
    } catch { /* reconcile on poll */ }
    await Promise.all([pollTimers(), pollQueue()]);
  }, [pollTimers, pollQueue, showToast]);

  const cancel = useCallback(async (id: number) => {
    setOverride(id, { removed: true }, 3500);
    try { await fetch(`/api/cooktimer/timers/${id}/cancel`, { method: 'POST' }); } catch { /* reconcile */ }
    await Promise.all([pollTimers(), pollQueue()]);
  }, [pollTimers, pollQueue]);

  const setMute = useCallback(async (id: number, expectedStep: number, muted: boolean) => {
    setOverride(id, { muted });
    if (!muted) lastBeep.current.delete(id);
    try {
      await fetch(`/api/cooktimer/timers/${id}/mute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_step: expectedStep, muted }),
      });
    } catch { /* reconcile */ }
    pollTimers();
  }, [pollTimers]);

  // --- settings ------------------------------------------------------------
  const toggleStation = useCallback((id: number) => {
    setEnabled(prev => {
      const base = prev ?? stations.map(s => s.id);
      const next = base.includes(id) ? base.filter(x => x !== id) : [...base, id];
      try { localStorage.setItem(LS_STATIONS, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [stations]);

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      try { localStorage.setItem(LS_SOUND, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // --- derived render list -------------------------------------------------
  const set = enabledSet();
  const timers: CookTimerDTO[] = serverTimers
    .map(mergeOne)
    .filter((t): t is CookTimerDTO => !!t && (set === null || set.has(t.stationId)));

  return {
    stations, enabled, soundOn, queue, timers, done, nowMs, toast, error,
    start, advance, skip, finish, cancel, setMute, toggleStation, toggleSound,
  };
}
