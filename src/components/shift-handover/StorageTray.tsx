'use client';

import React from 'react';
import { fmtTime, fmtDayShort } from './common';

export interface StorageRow {
  id: number;
  name: string;
  location_text: string | null;
  use_first: boolean;
  photo: string | null;
  added_by_name: string | null;
  added_at: string;
}

const MapPin = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

/** The persistent "In storage now" tray — items live here until marked used. */
export function StorageTray({ items, canPost, busyId, onUsed, today }: {
  items: StorageRow[]; canPost: boolean; busyId: number | null; onUsed: (id: number) => void; today: string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <h3 className="text-[var(--fs-sm)] font-bold text-gray-700">🧊 In storage now</h3>
        <span className="text-[var(--fs-xs)] text-gray-400">· {items.length}</span>
        {canPost && <span className="text-[var(--fs-xs)] text-gray-400 ml-auto">tap “Used up” when it’s gone</span>}
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {items.map((s, i) => (
          <div key={s.id} className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            {s.photo
              ? <img src={s.photo} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
              : <div className="w-10 h-10 rounded-lg bg-gray-100 grid place-items-center text-[18px] flex-shrink-0" aria-hidden="true">🧊</div>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{s.name}</span>
                {s.use_first && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">Use first</span>}
              </div>
              <div className="flex items-center gap-1 text-[var(--fs-xs)] text-gray-500 mt-0.5">
                {s.location_text && <><MapPin /><span className="truncate">{s.location_text}</span><span className="text-gray-300">·</span></>}
                <span className="flex-shrink-0">
                  {s.added_at.slice(0, 10) === today ? fmtTime(s.added_at) : `since ${fmtDayShort(s.added_at.slice(0, 10))}`}
                </span>
              </div>
            </div>
            {canPost && (
              <button
                onClick={() => onUsed(s.id)}
                disabled={busyId === s.id}
                className="flex-shrink-0 border border-gray-200 bg-white text-gray-600 text-[var(--fs-xs)] font-semibold rounded-lg px-3 py-2 active:bg-gray-50 disabled:opacity-50"
              >
                {busyId === s.id ? '…' : 'Used up'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
