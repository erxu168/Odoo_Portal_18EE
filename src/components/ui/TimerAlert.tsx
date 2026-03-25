'use client';

import React, { useEffect, useRef } from 'react';
import { TIMER_SOUNDS, playRepeating, type TimerSoundKey } from '@/lib/timer-sounds';
import { type NotificationSettings } from '@/lib/notification-settings';

export interface TimerAlertItem {
  sessionId: string;
  recipeName: string;
  stepLabel: string;   // e.g. "Step 2/4 · COOK"
  firedAt: number;     // Date.now() when this alert was created
}

interface Props {
  alerts: TimerAlertItem[];
  settings: NotificationSettings;
  onTap: (sessionId: string) => void;
  onDismiss: (sessionId: string) => void;
}

export default function TimerAlert({ alerts, settings, onTap, onDismiss }: Props) {
  const stopFnsRef = useRef<Map<string, () => void>>(new Map());
  const timerFnsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Start/stop repeating sounds per alert
  useEffect(() => {
    const currentIds = new Set(alerts.map(a => a.sessionId));

    // Start sound for new alerts
    for (const alert of alerts) {
      if (!stopFnsRef.current.has(alert.sessionId)) {
        if (settings.soundRepeatInterval > 0) {
          const stop = playRepeating(settings.sound, settings.soundRepeatInterval * 1000);
          stopFnsRef.current.set(alert.sessionId, stop);
        } else {
          // Play once
          TIMER_SOUNDS[settings.sound].play();
        }

        // Vibrate
        if (settings.vibration && navigator.vibrate) {
          navigator.vibrate([200, 100, 200, 100, 200]);
        }

        // Auto-dismiss timer
        if (settings.bannerDuration > 0) {
          const sid = alert.sessionId;
          const t = setTimeout(() => onDismiss(sid), settings.bannerDuration * 1000);
          timerFnsRef.current.set(sid, t);
        }
      }
    }

    // Stop sound for removed alerts
    const stopEntries = Array.from(stopFnsRef.current.entries());
    for (const [sid, stopFn] of stopEntries) {
      if (!currentIds.has(sid)) {
        stopFn();
        stopFnsRef.current.delete(sid);
        const t = timerFnsRef.current.get(sid);
        if (t) { clearTimeout(t); timerFnsRef.current.delete(sid); }
      }
    }

    return () => {
      // Cleanup all on unmount
      Array.from(stopFnsRef.current.values()).forEach(fn => fn());
      stopFnsRef.current.clear();
      Array.from(timerFnsRef.current.values()).forEach(t => clearTimeout(t));
      timerFnsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.map(a => a.sessionId).join(','), settings.sound, settings.soundRepeatInterval, settings.bannerDuration]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] flex flex-col">
      {alerts.map((alert, idx) => (
        <div
          key={alert.sessionId}
          className="animate-[slideDown_0.3s_ease-out]"
          style={{
            background: idx === 0
              ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
              : 'linear-gradient(135deg, #c53030, #991b1b)',
            paddingTop: idx === 0 ? '48px' : '0px',
          }}
          onClick={() => onTap(alert.sessionId)}
        >
          <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10">
            {/* Pulsing bell icon */}
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-[20px] flex-shrink-0 animate-pulse">
              {<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-bold text-white truncate">{alert.recipeName}</div>
              <div className="text-[12px] text-white/70">{alert.stepLabel} &middot; Timer done!</div>
            </div>
            {/* Dismiss button */}
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(alert.sessionId); }}
              className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center active:bg-white/30 flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
