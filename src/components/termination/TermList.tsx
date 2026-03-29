'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';
import { ds, getBadgeStyle } from '@/lib/design-system';
import AppHeader from '@/components/ui/AppHeader';

interface TermListProps {
  initialFilter?: string;
  onSelect: (id: number) => void;
  onHome: () => void;
}

export default function TermList({ initialFilter, onSelect, onHome }: TermListProps) {
  const { companyId } = useCompany();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter || 'all');
  const [search, setSearch] = useState('');

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'signed', label: 'Signed' },
    { key: 'archived', label: 'Archived' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('company_id', String(companyId));
    params.set('limit', '100');
    if (filter !== 'all') params.set('state', filter);
    if (search) params.set('search', search);
    fetch(`/api/hr/termination?${params}`)
      .then(r => r.json())
      .then(data => setRecords(data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [companyId, filter, search]);

  function formatDate(d: string | false): string {
    if (!d) return '---';
    const parts = d.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  const typeLabels: Record<string, string> = {
    ordentlich: 'Standard', ordentlich_probezeit: 'Probation',
    fristlos: 'Immediate', aufhebung: 'Mutual Agreement', bestaetigung: 'Confirmation',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', signed: 'Signed',
    archived: 'Archived', cancelled: 'Cancelled',
  };
  const stateBadgeMap: Record<string, string> = {
    draft: 'draft', confirmed: 'confirmed', signed: 'done', archived: 'neutral', cancelled: 'cancel',
  };

  return (
    <>
      <AppHeader title="Terminations" subtitle="All records" showBack onBack={onHome} />
      <div className="px-4 pt-3 pb-1">
        <input className={ds.input} type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className={ds.filterBar}>
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={filter === f.key ? ds.filterTabActive : ds.filterTabInactive}>{f.label}</button>
        ))}
      </div>
      <div className="px-4 pb-20">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>
        ) : records.length === 0 ? (
          <div className={ds.emptyState}>
            <div className={ds.emptyIcon}>\u{1F4CB}</div>
            <div className={ds.emptyTitle}>No terminations</div>
            <div className={ds.emptyBody}>No records found.</div>
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {records.map((r: any) => (
              <button key={r.id} onClick={() => onSelect(r.id)} className={`${ds.cardHover} w-full text-left p-3.5`}>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-gray-900 truncate">{r.employee_name}</span>
                  <span className="text-[11px] text-gray-400 font-medium">KW-{r.id}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={getBadgeStyle(stateBadgeMap[r.state] || 'neutral')}>{stateLabels[r.state] || r.state}</span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={getBadgeStyle('neutral')}>{typeLabels[r.termination_type] || r.termination_type}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1.5">
                  {formatDate(r.letter_date)}
                  {r.last_working_day && <> &middot; Last day: {formatDate(r.last_working_day)}</>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
