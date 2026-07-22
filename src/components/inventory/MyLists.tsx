'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { berlinToday } from '@/lib/berlin-date';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState } from './ui';
import RecordLink from '@/components/ui/RecordLink';

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

export default function MyLists({ userRole, onOpenSession, onHome }: MyListsProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadError, setLoadError] = useState(false);
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

      // Always filter to today (Berlin) — must match the server's session dates,
      // regardless of the tablet device's own timezone (see berlin-date.ts)
      params.set('date', berlinToday());

      const [sessRes, locRes] = await Promise.all([
        fetch(`/api/inventory/sessions?${params}`),
        locations.length === 0 ? fetch('/api/inventory/locations') : null,
      ]);

      if (!sessRes.ok) {
        // Never fall through to the "All done for today!" empty state on an error —
        // staff would skip real counts. Surface a distinct error instead.
        setLoadError(true);
        setSessions([]);
      } else {
        setLoadError(false);
        const sessData = await sessRes.json();
        setSessions(sessData.sessions || []);
      }

      if (locRes) {
        const locData = await locRes.json();
        setLocations(locData.locations || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setLoadError(true);
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
      <AppHeader
        title={userRole === 'admin' ? 'Today\u2019s Counts' : 'My Counts'}
        subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
        showBack
        onBack={onHome}
      />

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
        {loading ? <Spinner /> : loadError ? (
          <EmptyState icon={'⚠️'} title={"Couldn't load your lists"} body={'Something went wrong. Refresh or try again in a moment.'} />
        ) : sessions.length === 0 ? (
          <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((sess: any) => {
              const freqLabel = FREQ_LABELS[sess.template_frequency] || '';
              return (
                <div key={sess.id} className="bg-white border border-gray-200 rounded-2xl flex items-start">
                  <button onClick={() => onOpenSession(sess.id)}
                    className="flex-1 min-w-0 p-4 text-left active:scale-[0.98] transition-all">
                    {freqLabel && (
                      <span className={`inline-block text-[var(--fs-xs)] font-semibold px-2 py-0.5 rounded-md mb-1.5 ${
                        sess.template_frequency === 'daily'
                          ? 'bg-blue-50 text-blue-600'
                          : sess.template_frequency === 'weekly'
                            ? 'bg-purple-50 text-purple-600'
                            : 'bg-gray-100 text-gray-500'
                      }`}>
                        {freqLabel}
                      </span>
                    )}
                    <div className="text-[var(--fs-lg)] font-bold text-gray-900 leading-tight truncate">
                      {sess.template_name || `Session #${sess.id}`}
                    </div>
                    {sess.location_name && (
                      <div className="mt-2">
                        <span className="text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                          {sess.location_name}
                        </span>
                      </div>
                    )}
                  </button>
                  {/* Status + drill-down to the list — SIBLINGS of the open-session button */}
                  <div className="flex flex-col items-end gap-1.5 p-3 flex-shrink-0">
                    <StatusBadge status={sess.status} />
                    {sess.template_id && <RecordLink type="list" id={sess.template_id} label={sess.template_name} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
