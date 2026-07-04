'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onCreate: () => void;
}

interface CompanyOption { id: number; name: string; }

interface Leave {
  id: number;
  employee_name: string;
  type: string;
  date_from: string;
  date_to: string;
  days: number;
  state: string;
  company_name: string;
  department: string;
  can_act: boolean;
}

const STATE_META: Record<string, { label: string; cls: string }> = {
  confirm: { label: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  validate1: { label: 'Awaiting 2nd approval', cls: 'bg-amber-100 text-amber-700' },
  validate: { label: 'Approved', cls: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refused', cls: 'bg-red-100 text-red-700' },
  cancel: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
};

export default function TimeOff({ onBack, onCreate }: Props) {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/companies').then(r => r.json()).then(d => setCompanies(d.companies || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, selectedCompany]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (selectedCompany) params.set('company_id', String(selectedCompany));
      const res = await fetch('/api/hr/timeoff?' + params.toString());
      const data = await res.json();
      if (res.ok) setLeaves(data.leaves || []);
      else setError(data.error || 'Could not load time off.');
    } catch {
      setError('Could not load time off.');
    } finally {
      setLoading(false);
    }
  }

  async function decide(id: number, decision: 'approve' | 'refuse') {
    if (decision === 'refuse' && !window.confirm('Refuse this time-off request?')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/hr/timeoff/${id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update.');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = leaves.filter(l => l.can_act).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader title="Time Off" subtitle={status === 'pending' ? pendingCount + ' to review' : leaves.length + ' requests'} showBack onBack={onBack} />

      {/* Status toggle */}
      <div className="px-5 pt-4">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <SegBtn label="To review" active={status === 'pending'} onClick={() => setStatus('pending')} />
          <SegBtn label="All" active={status === 'all'} onClick={() => setStatus('all')} />
        </div>
      </div>

      {/* Company filter */}
      <div className="px-5 pt-3">
        <select
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-[var(--fs-sm)] font-semibold bg-white text-gray-700 outline-none focus:border-green-600 appearance-none"
          value={selectedCompany ?? ''}
          onChange={e => setSelectedCompany(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">All restaurants</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <div className="mx-5 mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}

      {/* List */}
      <div className="pt-3 px-5 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leaves.length === 0 ? (
          <div className="text-center text-gray-400 mt-10 text-[var(--fs-sm)]">
            {status === 'pending' ? 'Nothing to review' : 'No time-off requests'}
          </div>
        ) : (
          leaves.map(l => {
            const meta = STATE_META[l.state] || { label: l.state, cls: 'bg-gray-100 text-gray-500' };
            return (
              <div key={l.id} className="bg-white rounded-2xl p-4 border border-gray-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[var(--fs-md)] font-bold text-gray-900">{l.employee_name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{l.type}</div>
                  </div>
                  <span className={'flex-shrink-0 px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold ' + meta.cls}>{meta.label}</span>
                </div>
                <div className="text-[var(--fs-sm)] text-gray-700 mt-2 font-medium">
                  {fmt(l.date_from)}{l.date_to && l.date_to !== l.date_from ? ' → ' + fmt(l.date_to) : ''}
                  <span className="text-gray-400 font-normal"> · {l.days} {l.days === 1 ? 'day' : 'days'}</span>
                </div>
                {[l.company_name, l.department].filter(Boolean).length > 0 && (
                  <div className="text-[var(--fs-xs)] text-gray-400 mt-1">{[l.company_name, l.department].filter(Boolean).join(' · ')}</div>
                )}
                {l.can_act && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => decide(l.id, 'approve')} disabled={busyId === l.id}
                      className="flex-1 py-2.5 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-50">
                      {busyId === l.id ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => decide(l.id, 'refuse')} disabled={busyId === l.id}
                      className="flex-1 py-2.5 bg-white text-red-600 font-bold text-[var(--fs-sm)] rounded-xl border border-red-200 active:opacity-85 disabled:opacity-50">
                      Refuse
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Request on behalf */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        <button onClick={onCreate}
          className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Request time off
        </button>
      </div>
    </div>
  );
}

function SegBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={'flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-colors ' + (active ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500')}>
      {label}
    </button>
  );
}

function fmt(d: string): string {
  // Odoo date 'YYYY-MM-DD' -> 'DD.MM.YYYY' (German)
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
