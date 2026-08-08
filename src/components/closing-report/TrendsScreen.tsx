'use client';

// Closing Report — trends per department: submission rate, nightly team
// rating (single-hue bars, direct-labelled ends), recurring problems.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { CompanyPill } from '@/components/ui/CompanyPill';
import { api, fmtNight, type DeptEntry } from './common';

interface TrendsPayload {
  days: number;
  since: string;
  until: string;
  submitted_dates: string[];
  rating_by_date: { date: string; avg: number }[];
  problem_counts: { question_text: string; count: number }[];
  problems_total: number;
}

const CHART_NIGHTS = 14;

export default function TrendsScreen() {
  const [depts, setDepts] = useState<DeptEntry[]>([]);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0); // bumping re-runs the trends fetch even when deptId is unchanged (retry)
  const token = useRef(0);

  const loadDepts = useCallback(async () => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const d = await api<{ departments: DeptEntry[] }>('/api/closing-report/departments');
      if (my !== token.current) return;
      setDepts(d.departments);
      setDeptId((prev) => prev ?? d.departments[0]?.id ?? null);
      if (d.departments.length === 0) setLoading(false);
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDepts(); }, [loadDepts]);

  useEffect(() => {
    if (deptId == null) return;
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    api<TrendsPayload>(`/api/closing-report/trends?department_id=${deptId}&days=30`)
      .then((t) => { if (my === token.current) setTrends(t); })
      .catch((e) => { if (my === token.current) setLoadError(e instanceof Error ? e.message : 'Could not load.'); })
      .finally(() => { if (my === token.current) setLoading(false); });
  }, [deptId, reload]);

  // The chart shows the last 14 nights; a night without a report renders as a
  // faint full-height column so a gap is visible, not invisible.
  const chartNights: { date: string; avg: number | null }[] = [];
  if (trends) {
    const avgByDate = new Map(trends.rating_by_date.map((r) => [r.date, r.avg]));
    const submitted = new Set(trends.submitted_dates);
    const end = Date.parse(trends.until + 'T00:00:00Z');
    for (let i = CHART_NIGHTS - 1; i >= 0; i--) {
      const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
      chartNights.push({ date, avg: submitted.has(date) ? (avgByDate.get(date) ?? null) : null });
    }
  }
  const hasRatings = chartNights.some((n) => n.avg != null);
  const avgOverall = trends && trends.rating_by_date.length > 0
    ? Math.round((trends.rating_by_date.reduce((s, r) => s + r.avg, 0) / trends.rating_by_date.length) * 10) / 10
    : null;

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <AppHeader
        supertitle="Closing Reports"
        title="Trends"
        subtitle={trends ? `Last ${trends.days} nights` : undefined}
        backHref="/closing-report"
        action={<CompanyPill onSwitched={() => { setDeptId(null); setTrends(null); loadDepts(); }} />}
      />

      {depts.length > 1 && (
        <div className="flex gap-2 mt-4 overflow-x-auto">
          {depts.map((d) => (
            <button
              key={d.id}
              onClick={() => setDeptId(d.id)}
              className={`flex-shrink-0 min-h-[40px] px-4 rounded-full border text-[13px] font-semibold ${
                deptId === d.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="text-center text-gray-400 text-sm py-12">Loading…</div>}

      {!loading && loadError && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">{loadError}</p>
          <button onClick={() => (deptId != null ? setReload((r) => r + 1) : loadDepts())} className="mt-3 min-h-[44px] px-6 rounded-full border border-gray-300 text-[14px] font-semibold text-gray-600">Try again</button>
        </div>
      )}

      {!loading && !loadError && depts.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">No department takes part yet — set up questions first.</p>
        </div>
      )}

      {!loading && !loadError && trends && deptId != null && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2.5">
            <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-3.5">
              <p className="text-[22px] font-extrabold text-gray-900 tabular-nums">{trends.submitted_dates.length}<span className="text-[13px] text-gray-400 font-semibold"> / {trends.days}</span></p>
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 mt-0.5">Nights submitted</p>
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-3.5">
              <p className="text-[22px] font-extrabold text-gray-900 tabular-nums">{trends.problems_total}</p>
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 mt-0.5">Problems flagged</p>
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-3.5">
              <p className="text-[22px] font-extrabold text-gray-900 tabular-nums">{avgOverall ?? '—'}</p>
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 mt-0.5">Avg team rating</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-[14.5px] font-semibold text-gray-900">Team rating per night</h3>
            {hasRatings ? (
              <div className="mt-6">
                <div className="flex items-end gap-[3px] h-24 border-b border-gray-200" role="img" aria-label={`Team rating per night, last ${CHART_NIGHTS} nights, scale 1 to 5`}>
                  {chartNights.map((n, i) => (
                    <div key={n.date} className="flex-1 relative min-w-0 h-full flex items-end" title={n.avg != null ? `${fmtNight(n.date)}: ${n.avg} of 5` : `${fmtNight(n.date)}: no report`}>
                      {n.avg != null ? (
                        <div className="w-full bg-blue-600 rounded-t-[3px]" style={{ height: `${(n.avg / 5) * 100}%` }}>
                          {(i === chartNights.length - 1 || n.avg === 5) && (
                            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-bold text-gray-700 tabular-nums">{n.avg}</span>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gray-100 rounded-t-[3px]" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10.5px] text-gray-400 mt-1">
                  <span>{fmtNight(chartNights[0].date)}</span>
                  <span>{fmtNight(chartNights[chartNights.length - 1].date)}</span>
                </div>
                <p className="text-[11.5px] text-gray-400 mt-2">Grey = no report that night. Scale 1–5.</p>
              </div>
            ) : (
              <p className="text-[13px] text-gray-400 mt-2">No rating answers yet — they appear after the first reports.</p>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-[14.5px] font-semibold text-gray-900 mb-1">Recurring problems · last {trends.days} nights</h3>
            {trends.problem_counts.length === 0 ? (
              <p className="text-[13px] text-gray-400 mt-1">No problems flagged. Good sign.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {trends.problem_counts.map((p) => (
                  <div key={p.question_text} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[13.5px] text-gray-700 min-w-0">{p.question_text}</span>
                    <span className="flex-shrink-0 text-[12px] font-extrabold tabular-nums bg-red-50 text-red-600 rounded-full px-2.5 py-1">{p.count}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
