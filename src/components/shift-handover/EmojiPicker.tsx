'use client';

import React from 'react';

// A small, curated set of kitchen-relevant symbols. Managers pick one when they
// create a log type — no full emoji keyboard needed.
const EMOJIS = [
  '🍗', '🍚', '🍜', '🥘', '🍞', '🥩', '🐔', '🌶️',
  '🧊', '❄️', '🧀', '🥬', '🥕', '🍅', '🧅', '💧',
  '🧽', '🧼', '🧴', '🧹', '🧯', '🔥', '🌡️', '🔪',
  '🥣', '🍳', '🛢️', '🚚', '📦', '📋', '📝', '✅',
  '⏰', '🕐', '⚠️', '❗',
];

export function EmojiPicker({ value, onPick }: { value: string; onPick: (emoji: string) => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-2.5">
      <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">Pick a symbol</p>
      <div className="grid grid-cols-6 gap-1.5">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Symbol ${e}`}
            aria-pressed={value === e}
            className={`aspect-square rounded-lg grid place-items-center text-[22px] active:scale-95 transition-transform ${value === e ? 'bg-green-50 ring-2 ring-green-500' : 'bg-gray-50'}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
