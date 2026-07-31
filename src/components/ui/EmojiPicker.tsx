'use client';

import React from 'react';

/**
 * Curated symbol picker — no full emoji keyboard needed, and it works the same
 * on a phone and a desktop (typing an emoji on a Mac keyboard is a chore).
 *
 * Promoted to ui/ from shift-handover 2026-07-31 so the floorplan marker
 * library and any future builder use ONE picker. `set` chooses the vocabulary:
 * 'kitchen' (log types) or 'storage' (rooms, fridges, utilities, equipment).
 */
const KITCHEN = [
  '🍗', '🍚', '🍜', '🥘', '🍞', '🥩', '🐔', '🌶️',
  '🧊', '❄️', '🧀', '🥬', '🥕', '🍅', '🧅', '💧',
  '🧽', '🧼', '🧴', '🧹', '🧯', '🔥', '🌡️', '🔪',
  '🥣', '🍳', '🛢️', '🚚', '📦', '📋', '📝', '✅',
  '⏰', '🕐', '⚠️', '❗',
];

const STORAGE = [
  '🚪', '🏢', '🗺️', '🧭', '🚻', '🪜', '🛗', '🅿️',
  '🧊', '❄️', '🥶', '🍺', '🍷', '🧉', '🥤', '🧃',
  '🗄️', '🗃️', '🧰', '📦', '🧺', '🪣', '📚', '🛒',
  '🔧', '🔌', '💡', '🚿', '🚰', '💧', '🔥', '🧯',
  '⚡', '🔋', '🛢️', '🌡️', '🧴', '🧽', '🚽', '🩹',
  '🚑', '⛑️', '🔑', '📷', '📶', '🖨️', '🧑‍🍳', '⭐',
];

export function EmojiPicker({
  value,
  onPick,
  set = 'kitchen',
  title = 'Pick a symbol',
  columns = 6,
}: {
  value: string;
  onPick: (emoji: string) => void;
  set?: 'kitchen' | 'storage';
  title?: string;
  columns?: number;
}) {
  const list = set === 'storage' ? STORAGE : KITCHEN;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5">
      <p className="mb-2 text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400">{title}</p>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {list.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Symbol ${e}`}
            aria-pressed={value === e}
            className={`grid aspect-square place-items-center rounded-lg text-[20px] transition-transform active:scale-95 ${value === e ? 'bg-green-50 ring-2 ring-green-500' : 'bg-gray-50'}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export default EmojiPicker;
