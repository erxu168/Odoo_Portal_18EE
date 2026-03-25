'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, SearchBar, Spinner, EmptyState } from './ui';

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">
              {userRole === 'admin' ? 'All Inventory' : 'My Counts'}
            </h1>
            <p className="text-[12px] text-white/50 mt-0.5">
              {userRole === 'admin' ? 'All counting sessions' : 'Your assigned counting lists'}
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
          <EmptyState icon="\uD83D\uDCCB" title={`No ${statusLabel.toLowerCase()} lists`} body="Check back later or ask your manager to assign you a counting list." />
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((sess: any) => (
              <button key={sess.id} onClick={() => onOpenSession(sess.id)}
                className="bg-white border border-gray-200 rounded-2xl p-4 text-left active:scale-[0.98] transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-gray-400 font-mono">{sess.scheduled_date}</span>
                  <StatusBadge status={sess.status} />
                </div>
                <div className="text-[15px] font-bold text-gray-900 leading-tight">
                  {sess.template_name || `Session #${sess.id}`}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {sess.location_name && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                      {sess.location_name}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
