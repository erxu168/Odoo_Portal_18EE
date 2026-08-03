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
  /** Merged walk sessions: JSON array of {template_id, name, frequency}. */
  source_templates_json?: string | null;
}

const chipClass = (frequency: string) =>
  frequency === 'daily' ? 'bg-blue-50 text-blue-600'
    : frequency === 'weekly' ? 'bg-purple-50 text-purple-600'
    : frequency === 'monthly' ? 'bg-amber-50 text-amber-700'
    : 'bg-gray-100 text-gray-500';

export default function DueCountCard({ session, onOpen }: { session: DueSession; onOpen: (id: number) => void }) {
  const total = session.lines_total || 0;
  const done = Math.min(session.lines_done || 0, total);
  const started = session.status === 'in_progress' || done > 0;
  const freq = FREQ_LABELS[session.template_frequency || ''] || '';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // A merged walk carries its SOURCE lists — the card wears one chip per list
  // ("Daily + Weekly") so it's obvious what today's single walk covers.
  let sources: { name: string; frequency: string }[] = [];
  try {
    const parsed = JSON.parse(session.source_templates_json || '[]');
    if (Array.isArray(parsed)) sources = parsed.filter((s) => s && typeof s.name === 'string');
  } catch { /* malformed — fall back to the plain frequency chip */ }

  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className="w-full text-left bg-white border-[1.5px] border-blue-600 rounded-2xl p-4 shadow-[0_2px_10px_rgba(37,99,235,0.10)] active:scale-[0.985] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[var(--fs-lg)] font-extrabold text-gray-900 leading-tight [overflow-wrap:anywhere]">
            {sources.length > 0 ? 'Today\u2019s Count' : (session.template_name || `Count #${session.id}`)}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {sources.length > 0 ? (
              sources.map((src, i) => (
                <span key={`${src.name}#${i}`}
                  className={`text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md ${chipClass(src.frequency)}`}>
                  {i > 0 ? '+ ' : ''}{FREQ_LABELS[src.frequency] || src.name}
                </span>
              ))
            ) : freq ? (
              <span className={`text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md ${chipClass(session.template_frequency || '')}`}>{freq}</span>
            ) : null}
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
