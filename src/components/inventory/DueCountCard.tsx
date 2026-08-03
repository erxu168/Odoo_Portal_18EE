'use client';

import React from 'react';

/**
 * The "count me now" card on the Inventory landing: one card per count session
 * due TODAY, shown the moment staff open the module — the list is the front
 * page, not something behind a "My Lists" tile. Tapping anywhere opens the
 * guided walk for that session.
 *
 * Category-built lists freeze no line rows (lines_total = 0) — for those the
 * progress bar is omitted rather than lying "0 of 0".
 */

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  adhoc: 'One-off',
};

export interface DueSession {
  id: number;
  template_name?: string | null;
  template_frequency?: string | null;
  status: string;
  lines_total?: number | null;
  lines_done?: number | null;
  location_name?: string | null;
}

export default function DueCountCard({ session, onOpen }: { session: DueSession; onOpen: (id: number) => void }) {
  const total = session.lines_total || 0;
  const done = Math.min(session.lines_done || 0, total);
  const started = session.status === 'in_progress' || done > 0;
  const freq = FREQ_LABELS[session.template_frequency || ''] || '';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className="w-full text-left bg-white border-[1.5px] border-blue-600 rounded-2xl p-4 shadow-[0_2px_10px_rgba(37,99,235,0.10)] active:scale-[0.985] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[var(--fs-lg)] font-extrabold text-gray-900 leading-tight [overflow-wrap:anywhere]">
            {session.template_name || `Count #${session.id}`}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {freq && (
              <span className={`text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md ${
                session.template_frequency === 'daily' ? 'bg-blue-50 text-blue-600'
                  : session.template_frequency === 'weekly' ? 'bg-purple-50 text-purple-600'
                  : 'bg-gray-100 text-gray-500'
              }`}>{freq}</span>
            )}
            {session.location_name && (
              <span className="text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">{session.location_name}</span>
            )}
          </div>
        </div>
        {total > 0 && (
          <span className="flex-shrink-0 text-[var(--fs-xs)] font-bold text-gray-500 tabular-nums">{done} of {total}</span>
        )}
      </div>

      {total > 0 && (
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-3">
          <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="mt-3 py-3 rounded-xl bg-green-600 text-white text-center text-[var(--fs-base)] font-extrabold">
        {started ? 'Continue counting' : 'Start counting'} {'→'}
      </div>
    </button>
  );
}
