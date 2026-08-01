'use client';

import React from 'react';
import { fmtTime, fmtDayShort } from './common';

export interface StorageRow {
  id: number;
  name: string;
  item_id: number | null;
  amount: number | null;
  unit: string | null;
  prepared_on: string | null;
  location_id: number | null;
  location_text: string | null;
  use_first: boolean;
  photo: string | null;
  added_by_name: string | null;
  added_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

const MapPin = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

/** The persistent "In storage now" tray — items live here until someone clears them. */
export function StorageTray({ items, canPost, busyId, onClear, onOpen }: {
  items: StorageRow[]; canPost: boolean; busyId: number | null;
  onClear: (item: StorageRow) => void; onOpen: (item: StorageRow) => void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <h3 className="text-[var(--fs-sm)] font-bold text-gray-700">🧊 In storage now</h3>
        <span className="text-[var(--fs-xs)] text-gray-400">· {items.length}</span>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">current stock</span>
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {items.map((s, i) => (
          <div key={s.id} className={`flex items-stretch gap-3 p-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <button onClick={() => onOpen(s)} className="flex items-start gap-3 flex-1 min-w-0 text-left active:opacity-70" aria-label={`Open ${s.name}`}>
              {s.photo
                ? <img src={s.photo} alt="" className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                : <div className="w-11 h-11 rounded-lg bg-gray-100 grid place-items-center text-[18px] flex-shrink-0" aria-hidden="true">🧊</div>}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--fs-sm)] font-bold text-gray-900">{s.name}</span>
                  {s.amount != null && s.unit && <span className="text-[var(--fs-xs)] font-semibold text-gray-500">{s.amount} {s.unit}</span>}
                  {s.use_first && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">Use first</span>}
                </div>
                {s.location_text && (
                  <div className="flex items-start gap-1 text-[var(--fs-xs)] text-gray-500 mt-1">
                    <MapPin /><span className="break-words">{s.location_text}</span>
                  </div>
                )}
                <div className="text-[var(--fs-xs)] text-gray-400 mt-1">
                  {s.prepared_on ? `Prepared ${fmtDayShort(s.prepared_on)}` : ''}
                  {s.added_by_name ? ` · by ${s.added_by_name}` : ''}
                  {s.added_at ? ` ${fmtTime(s.added_at)}` : ''}
                </div>
              </div>
            </button>
            {canPost && (
              <button
                onClick={() => onClear(s)}
                disabled={busyId === s.id}
                className="flex-shrink-0 self-center border border-gray-200 bg-white text-gray-600 text-[var(--fs-xs)] font-semibold rounded-lg px-3 py-2 active:bg-gray-50 disabled:opacity-50"
              >
                {busyId === s.id ? '…' : 'What happened?'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
