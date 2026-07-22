'use client';

import React, { useState } from 'react';
import { fmtTime } from './common';

export interface FeedEntry {
  id: number;
  type_name: string;
  type_emoji: string;
  is_alert: boolean;
  note: string | null;
  photos: string[];
  author_user_id: number | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  storage_item_id: number | null;
  can_edit: boolean;
}

export function EntryCard({ entry, canPost, ackBusy, onAck, onEdit, onDelete, onViewPhoto }: {
  entry: FeedEntry; canPost: boolean; ackBusy: boolean;
  onAck: () => void; onEdit: () => void; onDelete: () => void; onViewPhoto: (photo: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const e = entry;

  return (
    <div className={`rounded-2xl p-3 flex gap-3 border ${e.is_alert ? 'bg-red-50 border-red-100' : 'bg-white border-gray-200'}`}>
      <div className={`w-9 h-9 rounded-xl grid place-items-center text-[19px] flex-shrink-0 ${e.is_alert ? 'bg-red-100' : 'bg-gray-100'}`} aria-hidden="true">
        {e.type_emoji}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <span className={`text-[var(--fs-sm)] font-bold ${e.is_alert ? 'text-red-700' : 'text-gray-900'}`}>{e.type_name}</span>
            <span className="text-[var(--fs-xs)] text-gray-400">
              {e.author_name ? ` · ${e.author_name}` : ''}{e.created_at ? ` · ${fmtTime(e.created_at)}` : ''}{e.edited_at ? ' · edited' : ''}
            </span>
          </div>
          {e.can_edit && (
            <div className="relative flex-shrink-0">
              <button onClick={() => setMenu((m) => !m)} aria-label="Edit or delete" className="w-7 h-7 -mt-1 -mr-1 grid place-items-center text-gray-400 active:text-gray-700 rounded-lg">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden w-32">
                    <button onClick={() => { setMenu(false); onEdit(); }} className="w-full text-left px-3 py-2.5 text-[var(--fs-sm)] text-gray-800 active:bg-gray-50">Edit</button>
                    <button onClick={() => { setMenu(false); onDelete(); }} className="w-full text-left px-3 py-2.5 text-[var(--fs-sm)] text-red-600 active:bg-red-50 border-t border-gray-100">Delete</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {e.note && <p className="text-[var(--fs-sm)] text-gray-700 leading-snug mt-0.5 whitespace-pre-wrap break-words">{e.note}</p>}

        {e.photos.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {e.photos.map((p, i) => (
              <button key={i} onClick={() => onViewPhoto(p)} className="active:opacity-80" aria-label="View photo">
                <img src={p} alt="" className="w-16 h-16 rounded-lg object-cover" />
              </button>
            ))}
          </div>
        )}

        {e.is_alert && (
          e.acknowledged_at ? (
            <div className="mt-2 flex items-center gap-1.5 text-[var(--fs-xs)] font-semibold text-green-700">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              Seen by {e.acknowledged_by_name || 'the next shift'}{e.acknowledged_at ? ` · ${fmtTime(e.acknowledged_at)}` : ''}
            </div>
          ) : canPost ? (
            <button onClick={onAck} disabled={ackBusy} className="mt-2.5 w-full h-9 rounded-xl border-[1.5px] border-red-500 text-red-600 text-[var(--fs-xs)] font-bold flex items-center justify-center gap-1.5 active:bg-red-50 disabled:opacity-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              {ackBusy ? 'Saving…' : 'I’ve read this'}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}
