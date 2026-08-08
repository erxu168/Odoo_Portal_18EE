'use client';

// The canonical record page for ONE closing report — stable URL
// /closing-report/report/[id], linkable from anywhere (review screen, emails).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ReportView from './ReportView';
import { api, fmtNight, fmtTimeBerlin, type ApiReport } from './common';

export default function ReportRecord({ reportId }: { reportId: number }) {
  const [report, setReport] = useState<ApiReport | null>(null);
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const token = useRef(0);

  const load = useCallback(async () => {
    const my = ++token.current;
    setLoading(true);
    setLoadError('');
    try {
      const p = await api<{ report: ApiReport; editable: boolean }>(`/api/closing-report/report/${reportId}`);
      if (my !== token.current) return;
      setReport(p.report);
      setEditable(p.editable);
    } catch (e) {
      if (my !== token.current) return;
      setLoadError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      if (my === token.current) setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <AppHeader
        supertitle="Closing Report"
        title={report ? `Night of ${fmtNight(report.report_date)}` : 'Report'}
        subtitle={report ? `Submitted ${fmtTimeBerlin(report.submitted_at)} by ${report.submitted_by_name}` : undefined}
        backHref="/closing-report"
      />
      {loading && <div className="text-center text-gray-400 text-sm py-12">Loading…</div>}
      {!loading && loadError && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center mt-4">
          <p className="text-[14px] text-gray-600">{loadError}</p>
          <button onClick={load} className="mt-3 min-h-[44px] px-6 rounded-full border border-gray-300 text-[14px] font-semibold text-gray-600">Try again</button>
        </div>
      )}
      {!loading && !loadError && report && (
        <div className="mt-4 space-y-3">
          {editable && (
            <p className="text-[12.5px] text-gray-500 bg-white border border-gray-200 rounded-xl p-3">
              Still correctable by {report.submitted_by_name} until 05:00 — after that this is the locked record.
            </p>
          )}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <ReportView report={report} />
          </div>
        </div>
      )}
    </div>
  );
}
