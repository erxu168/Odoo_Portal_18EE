'use client';

import React, { useState } from 'react';

/**
 * The kiosk's resting screen.
 *
 * The staff roster used to be the first thing on the tablet, which meant everyone's
 * name sat on a screen by the door all day. The kiosk now rests on this branded panel
 * and only reveals the roster when someone actually taps it — and falls back here when
 * it goes idle.
 *
 * The settings gear lives here too. It is the ONLY way a manager configures the tablet,
 * and on a device in Android lock-task mode there is no other route in, so it must be
 * reachable from the resting screen even though it is deliberately quiet.
 */

/** What a Jerk brand colours, taken from the master logo artwork. */
export const WAJ_RED = '#BE1E2D';
export const WAJ_YELLOW = '#EFA949';
/** Label colour for the yellow button — 6.9:1 on WAJ_YELLOW (AA at any size). */
const WAJ_INK = '#5A0E16';

interface Props {
  /** Current time, already formatted by the page so both screens agree. */
  clock: string;
  tabletName?: string;
  /** Reveal the staff roster. */
  onStart: () => void;
  onOpenSettings: () => void;
}

export default function KioskWelcome({ clock, tabletName, onStart, onOpenSettings }: Props) {
  // A broken logo file must never leave a broken-image icon on a customer-facing
  // screen — fall back to the wordmark set in type.
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: WAJ_RED }}>
      <div className="flex items-start justify-between px-6 pt-5">
        <div>
          <div className="text-white/90 text-[22px] font-bold tabular-nums leading-none">{clock}</div>
          {tabletName && <div className="text-white/50 text-[13px] font-semibold mt-1 truncate max-w-[40vw]">{tabletName}</div>}
        </div>
        <button
          onClick={onOpenSettings}
          aria-label="Kiosk settings"
          className="w-11 h-11 -mt-1 -mr-1 flex items-center justify-center rounded-full text-white/50 text-xl active:bg-white/15 active:text-white"
        >
          ⚙
        </button>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center gap-7 px-8 pb-12">
        {logoFailed ? (
          <div className="text-center font-extrabold leading-none" style={{ color: WAJ_YELLOW }}>
            <div className="text-[clamp(34px,9vw,64px)]">What a Jerk</div>
            <div className="text-[clamp(11px,2.4vw,15px)] tracking-[0.3em] mt-2">TRUE JAMAICAN FLAVOURS</div>
          </div>
        ) : (
          <img
            src="/waj-logo.svg"
            alt="What a Jerk"
            onError={() => setLogoFailed(true)}
            className="w-[min(72vw,360px)] max-h-[36vh] object-contain"
          />
        )}

        <div className="text-white text-center font-extrabold leading-tight text-[clamp(28px,7vw,44px)]">
          Hi there! 👋
        </div>

        <button
          onClick={onStart}
          className="w-full max-w-md rounded-3xl px-8 py-6 font-extrabold text-[clamp(20px,4.6vw,28px)] leading-snug shadow-lg active:scale-[0.97] transition-transform"
          style={{ backgroundColor: WAJ_YELLOW, color: WAJ_INK }}
        >
          Press here for attendance
        </button>
      </main>
    </div>
  );
}
