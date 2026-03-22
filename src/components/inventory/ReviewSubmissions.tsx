'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState } from './ui';
import StandardFilter from '@/components/ui/StandardFilter';

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
  const [reviewSession, setReviewSession] = useState<any>(null);
  const [reviewProducts, setReviewProducts] = useState<any[]>([]);
  const [reviewEntries, setReviewEntries] = useState<any[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState<'approve' | 'reject' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, qcRes] = await Promise.all([
        fetch(`/api/inventory/sessions?status=${filter}`).then((r) => r.json()),
        fetch(`/api/inventory/quick-count?status=${filter}`).then((r) => r.json()),
      ]);
      let sessData = sessRes.sessions || [];
      const qcData = qcRes.counts || [];

      // Apply date filter for approved/rejected
      if (dateRange && (filter === 'approved' || filter === 'rejected')) {
        sessData = sessData.filter((s: any) => {
          const d = (s.reviewed_at || s.scheduled_date || '').substring(0, 10);
          return d >= dateRange.from && d <= dateRange.to;
        });
      }

      setSessions(sessData);
      setQuickCounts(qcData);
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function openReview(sess: any) {
    setReviewLoading(true);
    setReviewSession(sess);
    setErrorMsg(null);
    try {
      const countRes = await fetch(`/api/inventory/counts?session_id=${sess.id}`).then(r => r.json());
      setReviewEntries(countRes.entries || []);

      let productIds: number[] = [];
      try { productIds = JSON.parse(sess.template_product_ids || '[]'); } catch { productIds = []; }

      if (productIds.length > 0) {
        const prodRes = await fetch(`/api/inventory/products?ids=${productIds.join(',')}`).then(r => r.json());
        setReviewProducts(prodRes.products || []);
      } else {
        let categoryIds: number[] = [];
        try { categoryIds = JSON.parse(sess.template_category_ids || '[]'); } catch { categoryIds = []; }
        if (categoryIds.length > 0) {
          const promises = categoryIds.map(cid => fetch(`/api/inventory/products?category_id=${cid}`).then(r => r.json()));
          const results = await Promise.all(promises);
          const all: any[] = [];
          const seen = new Set<number>();
          results.forEach(r => (r.products || []).forEach((p: any) => { if (!seen.has(p.id)) { seen.add(p.id); all.push(p); } }));
          setReviewProducts(all);
        }
      }
    } catch (err) {
      console.error('Failed to load review data:', err);
    } finally {
      setReviewLoading(false);
    }
  }

  async function handleAction(action: 'approve' | 'reject') {
    if (!reviewSession) return;
    setActionLoading(reviewSession.id);
    setErrorMsg(null);
    try {
      let res: Response;
      if (action === 'approve') {
        res = await fetch('/api/inventory/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: reviewSession.id }),
        });
      } else {
        res = await fetch('/api/inventory/sessions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: reviewSession.id, status: 'rejected' }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Action failed');
        setShowConfirm(null);
        return;
      }

      if (data.warning) {
        setErrorMsg(data.warning);
      }

      setShowConfirm(null);
      setReviewSession(null);
      setReviewProducts([]);
      setReviewEntries([]);
      fetchData();
    } catch (err) {
      console.error(`${action} failed:`, err);
      setErrorMsg('Network error. Please try again.');
      setShowConfirm(null);
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
  const showDateFilter = filter === 'approved' || filter === 'rejected';

  // ---- REVIEW DETAIL VIEW ----
  if (reviewSession) {
    const entryMap: Record<number, number> = {};
    reviewEntries.forEach((e: any) => { entryMap[e.product_id] = e.counted_qty; });
    const countedProducts = reviewProducts.filter(p => entryMap[p.id] !== undefined);
    const uncountedProducts = reviewProducts.filter(p => entryMap[p.id] === undefined);
    const isSubmitted = reviewSession.status === 'submitted';

    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => { setReviewSession(null); setReviewProducts([]); setReviewEntries([]); setErrorMsg(null); }}
              className="flex items-center gap-1 text-green-700 text-[13px] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Back to list
            </button>
          </div>
          <h1 className="text-[18px] font-bold text-[#1F2933]">{reviewSession.template_name || `Session #${reviewSession.id}`}</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">
            {reviewSession.scheduled_date} {'\u00B7'} {reviewSession.location_name || ''} {'\u00B7'} Counted by user #{reviewSession.assigned_user_id}
          </p>
        </div>

        {errorMsg && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[12px] font-semibold">
            {errorMsg}
          </div>
        )}

        {reviewLoading ? <Spinner /> : (
          <>
            <div className="px-4 pt-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-bold text-[#1F2933]">Count summary</span>
                  <span className="text-[12px] font-mono text-gray-500">{countedProducts.length}/{reviewProducts.length}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div className={`h-full rounded-full ${countedProducts.length === reviewProducts.length ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${reviewProducts.length > 0 ? (countedProducts.length / reviewProducts.length) * 100 : 0}%` }} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                    <div className="text-[20px] font-bold text-green-700 font-mono">{countedProducts.length}</div>
                    <div className="text-[11px] text-green-600 font-semibold">Counted</div>
                  </div>
                  <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                    <div className="text-[20px] font-bold text-amber-700 font-mono">{uncountedProducts.length}</div>
                    <div className="text-[11px] text-amber-600 font-semibold">Uncounted</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-36">
              {countedProducts.length > 0 && (
                <>
                  <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items</p>
                  {countedProducts.map((p) => {
                    const val = entryMap[p.id];
                    const uom = p.uom_id?.[1] || 'Units';
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                          </div>
                          <span className="text-[13px] text-gray-900 truncate">{p.name}</span>
                        </div>
                        <span className="text-[14px] font-mono font-semibold text-[#1F2933] flex-shrink-0 ml-3">
                          {val} <span className="text-[11px] text-gray-400 font-normal">{uom}</span>
                        </span>
                      </div>
                    );
                  })}
                </>
              )}

              {uncountedProducts.length > 0 && (
                <>
                  <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted</p>
                  {uncountedProducts.map((p) => {
                    const uom = p.uom_id?.[1] || 'Units';
                    return (
                      <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-400 text-[10px] font-bold">--</span>
                          </div>
                          <span className="text-[13px] text-gray-500 truncate">{p.name}</span>
                        </div>
                        <span className="text-[12px] text-gray-400 flex-shrink-0 ml-3">-- {uom}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {isSubmitted && (
              <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm('reject')}
                    className="py-3.5 px-6 rounded-xl border border-red-200 text-red-600 text-[14px] font-bold active:bg-red-50">
                    Reject
                  </button>
                  <button onClick={() => setShowConfirm('approve')}
                    className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
                    Approve
                  </button>
                </div>
              </div>
            )}

            {showConfirm && (
              <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
                <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
                  <h3 className="text-[17px] font-bold text-[#1F2933] mb-2">
                    {showConfirm === 'approve' ? 'Approve this count?' : 'Reject this count?'}
                  </h3>
                  <p className="text-[13px] text-gray-500 mb-5">
                    {showConfirm === 'approve'
                      ? `This will accept ${countedProducts.length} counted items and update inventory in Odoo.`
                      : 'The staff member will be notified and can recount.'}
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setShowConfirm(null)}
                      className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[14px] font-semibold active:bg-gray-200">
                      Cancel
                    </button>
                    <button onClick={() => handleAction(showConfirm)} disabled={actionLoading !== null}
                      className={`flex-1 py-3.5 rounded-xl text-white text-[14px] font-bold disabled:opacity-50 ${
                        showConfirm === 'approve'
                          ? 'bg-green-600 shadow-lg shadow-green-600/30 active:bg-green-700'
                          : 'bg-red-500 shadow-lg shadow-red-500/30 active:bg-red-600'
                      }`}>
                      {actionLoading !== null ? '...' : showConfirm === 'approve' ? 'Yes, approve' : 'Yes, reject'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ---- LIST VIEW ----
  return (
    <div className="flex flex-col min-h-0 flex-1">
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

      <div className="pt-2">
        <FilterBar>
          {['submitted', 'approved', 'rejected'].map((s) => (
            <FilterPill key={s} active={filter === s}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              onClick={() => { setFilter(s); setDateRange(null); }} />
          ))}
        </FilterBar>
      </div>

      {showDateFilter && (
        <div className="px-4 pb-2">
          <StandardFilter onChange={(range) => setDateRange(range)} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <Spinner /> : (
          <>
            {tab === 'sessions' && (
              sessions.length === 0 ? (
                <EmptyState icon={'\u2705'} title={`No ${filter} sessions`} />
              ) : (
                <div className="flex flex-col gap-3">
                  {sessions.map((sess: any) => (
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
                      {sess.status === 'submitted' ? (
                        <button onClick={() => openReview(sess)}
                          className="w-full py-2.5 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700 shadow-sm">
                          Review
                        </button>
                      ) : (
                        <button onClick={() => openReview(sess)}
                          className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[13px] font-semibold active:bg-gray-200">
                          View details
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'quick' && (
              quickCounts.length === 0 ? (
                <EmptyState icon={'\uD83D\uDD0D'} title={`No ${filter} quick counts`} />
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
                              className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-[13px] font-bold active:bg-green-600 disabled:opacity-50">
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
