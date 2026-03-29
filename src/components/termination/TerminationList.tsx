'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { TERMINATION_TYPE_LABELS, STATE_LABELS } from '@/types/termination';
import type { TerminationRecord, TerminationType, TerminationState } from '@/types/termination';

interface Props {
  filter?: string;
  onSelect: (id: number) => void;
  onBack: () => void;
  onHome: () => void;
}

const STATE_COLORS: Record<TerminationState, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  signed: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
};

export default function TerminationList({ filter, onSelect, onBack }: Props) {
  const [records, setRecords] = useState<TerminationRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let url = '/api/termination';
        if (filter === 'active') url += '?state=confirmed';
        else if (filter === 'delivered') url += '?state=delivered';
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
          let recs = data.data || [];
          if (filter === 'active') {
            const res2 = await fetch('/api/termination?state=signed');
            const data2 = await res2.json();
            if (data2.ok) recs = [...recs, ...(data2.data || [])];
          }
          setRecords(recs);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [filter]);

  const filtered = records.filter(r =>
    !search || r.employee_name?.toLowerCase().includes(search.toLowerCase())
  );

  const title = filter === 'active' ? 'In Bearbeitung' : filter === 'delivered' ? 'Zugestellt' : 'Alle K\u00fcndigungen';

  return (
    <>
      <AppHeader title={title} subtitle={`${filtered.length} Eintr\u00e4ge`} showBack onBack={onBack} />
      <div className="px-4 py-3">
        <input
          type="text"
          placeholder="Mitarbeiter suchen..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="px-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">Keine K\u00fcndigungen gefunden</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(rec => (
              <button
                key={rec.id}
                onClick={() => onSelect(rec.id)}
                className="w-full text-left bg-white rounded-xl border border-gray-100 p-4 shadow-sm active:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{rec.employee_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {TERMINATION_TYPE_LABELS[rec.termination_type as TerminationType] || rec.termination_type}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {rec.letter_date} \u2022 Letzter Tag: {rec.last_working_day || '\u2013'}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATE_COLORS[rec.state as TerminationState] || 'bg-gray-100'}`}>
                    {STATE_LABELS[rec.state as TerminationState] || rec.state}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
