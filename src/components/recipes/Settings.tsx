'use client';

import React, { useState } from 'react';
import {
  type NotificationSettings,
  BANNER_DURATION_OPTIONS,
  SOUND_REPEAT_OPTIONS,
  saveSettings,
} from '@/lib/notification-settings';
import { TIMER_SOUNDS, type TimerSoundKey } from '@/lib/timer-sounds';

interface Props {
  notifSettings: NotificationSettings;
  onNotifChange: (s: NotificationSettings) => void;
  onBack: () => void;
}

export default function Settings({ notifSettings, onNotifChange, onBack }: Props) {
  const [local, setLocal] = useState<NotificationSettings>({ ...notifSettings });
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(section: string) {
    setExpanded(prev => prev === section ? null : section);
  }

  function update(patch: Partial<NotificationSettings>) {
    const next = { ...local, ...patch };
    setLocal(next);
    saveSettings(next);
    onNotifChange(next);
  }

  const soundKeys = Object.keys(TIMER_SOUNDS) as TimerSoundKey[];

  return (
    <div className="min-h-screen bg-[#1C1C1E] flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Settings</h1>
            <p className="text-[12px] text-zinc-400">Chef Guide preferences</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">

        {/* ── Notifications & Sounds ── */}
        <div className="rounded-2xl border border-zinc-700 bg-white/[0.02] overflow-hidden">
          <button
            onClick={() => toggle('notifications')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-white/[0.04]"
          >
            <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-semibold text-white">Notifications &amp; Sounds</div>
              <div className="text-[12px] text-zinc-400">Timer alerts, sounds, vibration</div>
            </div>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"
              className={`transition-transform ${expanded === 'notifications' ? 'rotate-90' : ''}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          {expanded === 'notifications' && (
            <div className="px-4 pb-5 space-y-6 border-t border-white/5 pt-4">

              {/* Alert Sound */}
              <section>
                <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Alert Sound</h2>
                <div className="space-y-2">
                  {soundKeys.map((key) => {
                    const s = TIMER_SOUNDS[key];
                    const selected = local.sound === key;
                    return (
                      <button
                        key={key}
                        onClick={() => { update({ sound: key }); s.play(); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-colors ${
                          selected
                            ? 'border-green-500 bg-green-500/10'
                            : 'border-zinc-700 bg-zinc-800/80 active:bg-white/[0.06]'
                        }`}
                      >
                        <span className="text-[20px]">{s.icon}</span>
                        <span className={`flex-1 text-left text-[15px] font-semibold ${selected ? 'text-green-400' : 'text-zinc-200'}`}>{s.label}</span>
                        <div
                          onClick={(e) => { e.stopPropagation(); s.play(); }}
                          className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center active:bg-zinc-600"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={selected ? '#4ade80' : 'rgba(255,255,255,0.5)'} strokeWidth="2">
                            <polygon points="5,3 19,12 5,21" />
                          </svg>
                        </div>
                        {selected && (
                          <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Sound Repeat */}
              <section>
                <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Sound Repeat</h2>
                <p className="text-[12px] text-zinc-400 mb-3">How often the sound plays while the alert is showing</p>
                <div className="flex flex-wrap gap-2">
                  {SOUND_REPEAT_OPTIONS.map((opt) => {
                    const selected = local.soundRepeatInterval === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => update({ soundRepeatInterval: opt.value })}
                        className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border-2 transition-colors ${
                          selected
                            ? 'border-green-500 bg-green-500/10 text-green-400'
                            : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 active:bg-white/[0.06]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Banner Duration */}
              <section>
                <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Banner Duration</h2>
                <p className="text-[12px] text-zinc-400 mb-3">How long the notification banner stays on screen</p>
                <div className="flex flex-wrap gap-2">
                  {BANNER_DURATION_OPTIONS.map((opt) => {
                    const selected = local.bannerDuration === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => update({ bannerDuration: opt.value })}
                        className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border-2 transition-colors ${
                          selected
                            ? 'border-green-500 bg-green-500/10 text-green-400'
                            : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 active:bg-white/[0.06]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Vibration */}
              <section>
                <h2 className="text-[13px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Vibration</h2>
                <button
                  onClick={() => update({ vibration: !local.vibration })}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-colors ${
                    local.vibration
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-zinc-700 bg-zinc-800/80'
                  }`}
                >
                  <span className="text-[20px]">{<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="20" rx="2"/><path d="M2 8v8M22 8v8M5 5v14M19 5v14"/></svg>}</span>
                  <span className={`flex-1 text-left text-[15px] font-semibold ${local.vibration ? 'text-green-400' : 'text-zinc-300'}`}>
                    {local.vibration ? 'Vibration on' : 'Vibration off'}
                  </span>
                  <div className={`w-11 h-6 rounded-full transition-colors relative ${local.vibration ? 'bg-green-500' : 'bg-zinc-600'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${local.vibration ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </section>
            </div>
          )}
        </div>

        {/* ── Placeholder for future settings sections ── */}
        {/* More settings groups will go here */}

      </div>
    </div>
  );
}
