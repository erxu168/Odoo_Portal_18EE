'use client';

import React, { useState, useEffect } from 'react';
import { TERMINATION_TYPE_LABELS, STATE_LABELS, type TerminationState } from '@/types/termination';
import { useCompany } from '@/lib/company-context';

interface Props {
  filter?: TerminationState[];
  onSelect: (id: number) => void;
  onHome: () => void;
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  signed: 'bg-green-100 text-green-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
};

export default function TermList({ filter, onSelect, onHome }: Props) {
  const { companyId } = useCompany();
  const [records, setRecords] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const url = companyId
          ? `/api/termination?company_id=${companyId}&limit=500`
          : '/api/termination?limit=500';
        const res = await fetch(url);
        const json = await res.json();
        setRecords(json.data || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const filtered = records.filter(r => {
    if (filter && !filter.includes(r.state)) return false;
    if (search && !r.employee_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const fmt = (d: string | false) => {
    if (!d) return '\u2013';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  const title = filter
    ? filter.map(s => STATE_LABELS[s]).join(' & ')
    : 'All Terminations';

  return (
    <div>
      <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">{title}</h1>
            <p className="text-[12px] text-white/45 mt-0.5">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <input
          type="text" placeholder="Search by name..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3"
        />

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 text-[13px] py-8">No terminations found</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((r: any) => (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="w-full bg-white rounded-xl border border-gray-200 p-4 text-left active:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[14px] font-semibold text-gray-900">{r.employee_name}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {TERMINATION_TYPE_LABELS[r.termination_type as keyof typeof TERMINATION_TYPE_LABELS] || r.termination_type}
                    </div>
                  </div>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${STATE_COLORS[r.state] || ''}`}>
                    {STATE_LABELS[r.state as keyof typeof STATE_LABELS] || r.state}
                  </span>
                </div>
                <div className="flex gap-4 mt-2 text-[11px] text-gray-400">
                  <span>Letter: {fmt(r.letter_date)}</span>
                  <span>Last day: {fmt(r.last_working_day)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
