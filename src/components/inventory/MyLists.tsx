'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState } from './ui';

interface MyListsProps {
  userRole: string;
  onOpenSession: (sessionId: number) => void;
  onHome: () => void;
}

const STATUS_FILTER_OPTIONS = [
  { key: 'pending', label: 'To count' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
];

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  adhoc: 'Ad-hoc',
};

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MyLists({ userRole, onOpenSession, onHome }: MyListsProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [locationFilter, setLocationFilter] = useState('all');
  const [locations, setLocations] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (locationFilter !== 'all') params.set('location_id', locationFilter);

      // Always filter to today — staff only needs to see today's tasks
      params.set('date', getTodayStr());

      const [sessRes, locRes] = await Promise.all([
        fetch(`/api/inventory/sessions?${params}`),
        locations.length === 0 ? fetch('/api/inventory/locations') : null,
      ]);

      const sessData = await sessRes.json();
      setSessions(sessData.sessions || []);

      if (locRes) {
        const locData = await locRes.json();
        setLocations(locData.locations || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, locationFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusLabel = STATUS_FILTER_OPTIONS.find(o => o.key === statusFilter)?.label || statusFilter;

  const emptyMessages: Record<string, { icon: string; title: string; body: string }> = {
    pending: {
      icon: '\u2705',
      title: 'All done for today!',
      body: 'No counting lists pending. Check back tomorrow or ask your manager if something is missing.',
    },
    submitted: {
      icon: '\u23F3',
      title: 'Nothing submitted today',
      body: 'Once you complete and submit a count, it will appear here.',
    },
    approved: {
      icon: '\uD83D\uDCCB',
      title: 'No approvals yet today',
      body: 'Approved counts for today will show here.',
    },
  };

  const empty = emptyMessages[statusFilter] || {
    icon: '\uD83D\uDCCB',
    title: `No ${statusLabel.toLowerCase()} lists`,
    body: 'Check back later.',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome} className="w-11 h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">
              {userRole === 'admin' ? 'Today\u2019s Counts' : 'My Counts'}
            </h1>
            <p className="text-[var(--fs-sm)] text-white/50 mt-0.5">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="pt-3">
        <FilterBar>
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <FilterPill key={opt.key} active={statusFilter === opt.key}
              label={opt.label}
              onClick={() => setStatusFilter(opt.key)} />
          ))}
        </FilterBar>
      </div>

      {/* Location filter - only show if user has more than 1 location */}
      {locations.length > 1 && (
        <FilterBar>
          <FilterPill active={locationFilter === 'all'} label="All locations" onClick={() => setLocationFilter('all')} />
          {locations.map((loc: any) => (
            <FilterPill key={loc.id} active={locationFilter === String(loc.id)}
              label={loc.complete_name?.split('/')[0] || loc.name}
              onClick={() => setLocationFilter(String(loc.id))} />
          ))}
        </FilterBar>
      )}

      {/* Session cards */}
      <div className="px-4 pb-24">
        {loading ? <Spinner /> : sessions.length === 0 ? (
          <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((sess: any) => {
              const freqLabel = FREQ_LABELS[sess.template_frequency] || '';
              return (
                <button key={sess.id} onClick={() => onOpenSession(sess.id)}
                  className="bg-white border border-gray-200 rounded-2xl p-4 text-left active:scale-[0.98] transition-all">
                  <div className="flex items-center justify-between mb-1.5">
                    {freqLabel && (
                      <span className={`text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md ${
                        sess.template_frequency === 'daily'
                          ? 'bg-blue-50 text-blue-600'
                          : sess.template_frequency === 'weekly'
                            ? 'bg-purple-50 text-purple-600'
                            : 'bg-gray-100 text-gray-500'
                      }`}>
                        {freqLabel}
                      </span>
                    )}
                    <StatusBadge status={sess.status} />
                  </div>
                  <div className="text-[var(--fs-lg)] font-bold text-gray-900 leading-tight">
                    {sess.template_name || `Session #${sess.id}`}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {sess.location_name && (
                      <span className="text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                        {sess.location_name}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
