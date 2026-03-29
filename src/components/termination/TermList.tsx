'use client';

import React, { useState, useEffect } from 'react';
import {
  TERMINATION_TYPE_LABELS,
  STATE_LABELS,
  type TerminationRecord,
  type TerminationState,
} from '@/types/termination';

interface TermListProps {
  filter?: TerminationState[];
  onSelect: (id: number) => void;
  onHome: () => void;
}

const STATE_COLORS: Record<TerminationState, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  signed: 'bg-green-100 text-green-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-gray-200 text-gray-500',
  cancelled: 'bg-red-100 text-red-600',
};

export default function TermList({ filter, onSelect, onHome }: TermListProps) {
  const [records, setRecords] = useState<TerminationRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/termination?limit=500');
        const json = await res.json();
        let data = json.data || [];
        if (filter && filter.length > 0) {
          data = data.filter((r: TerminationRecord) => filter.includes(r.state));
        }
        setRecords(data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [filter]);

  const filtered = records.filter(r =>
    !search || r.employee_name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          <h1 className="text-[20px] font-bold text-white">K\u00fcndigungen</h1>
        </div>
        <div className="mt-3">
          <input
            type="text"
            placeholder="Mitarbeiter suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/15 text-white placeholder-white/50 text-[14px] border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12">Keine K\u00fcndigungen gefunden</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="w-full bg-white rounded-xl border border-gray-200 p-4 text-left active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-gray-900 truncate">{r.employee_name}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {TERMINATION_TYPE_LABELS[r.termination_type]} \u2022 {r.letter_date}
                    </div>
                    {r.last_working_day && (
                      <div className="text-[11px] text-gray-400 mt-0.5">Letzter Tag: {r.last_working_day}</div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATE_COLORS[r.state]}`}>
                    {STATE_LABELS[r.state]}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
