'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState, BackHeader } from './ui';

interface ReviewSubmissionsProps {
  onViewSession: (sessionId: number) => void;
}

export default function ReviewSubmissions({ onViewSession }: ReviewSubmissionsProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [quickCounts, setQuickCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('submitted');
  const [tab, setTab] = useState<'sessions' | 'quick'>('sessions');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, qcRes] = await Promise.all([
        fetch(`/api/inventory/sessions?status=${filter}`).then((r) => r.json()),
        fetch(`/api/inventory/quick-count?status=${filter}`).then((r) => r.json()),
      ]);
      setSessions(sessRes.sessions || []);
      setQuickCounts(qcRes.counts || []);
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function approveSession(sessionId: number) {
    setActionLoading(sessionId);
    try {
      await fetch('/api/inventory/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      fetchData();
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function rejectSession(sessionId: number) {
    setActionLoading(sessionId);
    try {
      await fetch('/api/inventory/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'rejected' }),
      });
      fetchData();
    } catch (err) {
      console.error('Reject failed:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function approveQuickCount(qcId: number) {
    setActionLoading(qcId + 100000);
    try {
      await fetch('/api/inventory/quick-count/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: qcId }),
      });
      fetchData();
    } catch (err) {
      console.error('QC approve failed:', err);
    } finally {
      setActionLoading(null);
    }
  }

  const pendingSessions = sessions.filter((s) => s.status === 'submitted').length;
  const pendingQC = quickCounts.filter((q) => q.status === 'pending').length;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Session vs Quick Count toggle */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setTab('sessions')}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-center transition-all ${
              tab === 'sessions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}>
            Sessions {pendingSessions > 0 && <span className="ml-1 text-[11px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{pendingSessions}</span>}
          </button>
          <button onClick={() => setTab('quick')}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-center transition-all ${
              tab === 'quick' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}>
            Quick counts {pendingQC > 0 && <span className="ml-1 text-[11px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{pendingQC}</span>}
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="pt-2">
        <FilterBar>
          {['submitted', 'approved', 'rejected'].map((s) => (
            <FilterPill key={s} active={filter === s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              onClick={() => setFilter(s)} />
          ))}
        </FilterBar>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <Spinner /> : (
          <>
            {tab === 'sessions' && (
              sessions.length === 0 ? (
                <EmptyState icon="\u2705" title={`No ${filter} sessions`} />
              ) : (
                <div className="flex flex-col gap-3">
                  {sessions.map((sess: any) => {
                    const isLoading = actionLoading === sess.id;
                    return (
                      <div key={sess.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[15px] font-bold text-gray-900">
                            {sess.template_name || `Session #${sess.id}`}
                          </span>
                          <StatusBadge status={sess.status} />
                        </div>
                        <div className="text-[12px] text-gray-500 mb-3">
                          {sess.scheduled_date} {sess.location_name && `\u00B7 ${sess.location_name}`}
                        </div>

                        {sess.status === 'submitted' && (
                          <div className="flex gap-2">
                            <button onClick={() => approveSession(sess.id)} disabled={isLoading}
                              className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-[13px] font-bold active:bg-emerald-600 disabled:opacity-50">
                              {isLoading ? '...' : 'Approve'}
                            </button>
                            <button onClick={() => rejectSession(sess.id)} disabled={isLoading}
                              className="py-2.5 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold active:bg-red-50 disabled:opacity-50">
                              Reject
                            </button>
                            <button onClick={() => onViewSession(sess.id)}
                              className="py-2.5 px-4 rounded-xl border border-gray-200 text-gray-500 text-[13px] font-semibold active:bg-gray-50">
                              View
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {tab === 'quick' && (
              quickCounts.length === 0 ? (
                <EmptyState icon="\uD83D\uDD0D" title={`No ${filter} quick counts`} />
              ) : (
                <div className="flex flex-col gap-3">
                  {quickCounts.map((qc: any) => {
                    const isLoading = actionLoading === qc.id + 100000;
                    return (
                      <div key={qc.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[14px] font-bold text-gray-900">
                            Product #{qc.product_id}
                          </span>
                          <StatusBadge status={qc.status} />
                        </div>
                        <div className="flex items-center gap-3 text-[13px] text-gray-500">
                          <span className="font-mono font-semibold text-gray-900">{qc.counted_qty} {qc.uom}</span>
                          <span>by user #{qc.counted_by}</span>
                          <span>{new Date(qc.submitted_at).toLocaleDateString('de-DE')}</span>
                        </div>

                        {qc.status === 'pending' && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => approveQuickCount(qc.id)} disabled={isLoading}
                              className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-[13px] font-bold active:bg-emerald-600 disabled:opacity-50">
                              {isLoading ? '...' : 'Approve'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
