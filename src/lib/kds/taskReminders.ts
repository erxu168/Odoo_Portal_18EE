'use client';

/**
 * Task reminders for the KDS.
 * Polls the task feed, and when a task's due time is within the lead window (or
 * past), pops a reminder that fades after a few seconds and re-appears every few
 * minutes until the task is marked done (elsewhere, on the staff tablet).
 * Orders always win: page.tsx calls dismiss() when a new order arrives.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { playTaskReminder } from './soundEngine';

interface RawTask { id: number; name: string; deadlineMs: number; }

export interface ActiveReminder {
  showId: number;
  id: number;
  name: string;
  dueInMin: number;
  overdue: boolean;
}

const LEAD_MS = 30 * 60 * 1000;   // start reminding 30 min before due
const REPEAT_MS = 5 * 60 * 1000;  // re-show roughly every 5 min
const SHOW_MS = 12 * 1000;        // each pop stays ~12s
const POLL_MS = 60 * 1000;        // refresh the task list every 60s
const TICK_MS = 15 * 1000;        // scheduler granularity (first show within ~15s)
const SNOOZE_MS = 10 * 60 * 1000; // snoozed tasks stay quiet for 10 min

export function useTaskReminders(configId: number, muted: boolean): {
  reminder: ActiveReminder | null;
  dismiss: () => void;
  snooze: (taskId: number) => void;
} {
  const [reminder, setReminder] = useState<ActiveReminder | null>(null);
  const tasksRef = useRef<RawTask[]>([]);
  const cycleRef = useRef(0);
  const showIdRef = useRef(0);
  const lastShowRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snoozedRef = useRef<Map<number, number>>(new Map()); // taskId -> snooze-until ms
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Poll the task feed.
  useEffect(() => {
    if (!configId) return;
    let active = true;
    async function poll() {
      try {
        const res = await fetch(`/api/kds/tasks?configId=${configId}`);
        const data = await res.json();
        if (active && Array.isArray(data.tasks)) tasksRef.current = data.tasks;
      } catch {
        /* offline — keep the last list */
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [configId]);

  const dismiss = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setReminder(null);
  }, []);

  const snooze = useCallback((taskId: number) => {
    snoozedRef.current.set(taskId, Date.now() + SNOOZE_MS);
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setReminder(null);
  }, []);

  // Scheduler: decide when to pop the next due reminder.
  useEffect(() => {
    if (!configId) return;
    const tick = setInterval(() => {
      const now = Date.now();
      const activeList = tasksRef.current
        .filter(t => t.deadlineMs - now <= LEAD_MS)        // within window or overdue
        .filter(t => {                                     // skip snoozed tasks
          const until = snoozedRef.current.get(t.id);
          return !until || now >= until;
        })
        .sort((a, b) => a.deadlineMs - b.deadlineMs);

      if (activeList.length === 0) {
        lastShowRef.current = 0;   // reset so the next due task shows immediately
        return;
      }
      if (now - lastShowRef.current < REPEAT_MS) return;   // not time to re-pop yet

      const t = activeList[cycleRef.current % activeList.length];
      cycleRef.current += 1;
      lastShowRef.current = now;
      const dueInMin = Math.round((t.deadlineMs - now) / 60000);
      showIdRef.current += 1;
      setReminder({
        showId: showIdRef.current,
        id: t.id,
        name: t.name,
        dueInMin: Math.max(0, dueInMin),
        overdue: dueInMin <= 0,
      });
      if (!mutedRef.current) playTaskReminder();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setReminder(null), SHOW_MS);
    }, TICK_MS);
    return () => {
      clearInterval(tick);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [configId]);

  return { reminder, dismiss, snooze };
}
