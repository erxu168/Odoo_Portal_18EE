'use client';

// The Closing Report entry card at the bottom of the daily checklist on
// /tasks/staff — the natural last step of closing. Self-contained: it fetches
// its own status and renders NOTHING when the user lacks the closing-report
// module or no department takes part, so the tasks page needs no knowledge of it.
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtTimeBerlin, type DeptEntry } from './common';

export default function ClosingReportCard({ departmentId }: { departmentId: number | null }) {
  const router = useRouter();
  const [dept, setDept] = useState<DeptEntry | null>(null);
  const [hidden, setHidden] = useState(true);
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    api<{ departments: DeptEntry[] }>('/api/closing-report/departments')
      .then((d) => {
        if (my !== token.current) return;
        // The user's own department when it takes part, else the only
        // participating one; two-plus ambiguous departments still show a card
        // (staff pick the department on the module screen).
        const mine = departmentId != null ? d.departments.find((x) => x.id === departmentId) : undefined;
        const target = mine || (d.departments.length === 1 ? d.departments[0] : null);
        if (target) { setDept(target); setHidden(false); }
        else if (d.departments.length > 1) { setDept(null); setHidden(false); }
        else setHidden(true);
      })
      .catch(() => { if (my === token.current) setHidden(true); }); // no module access / error → no card
  }, [departmentId]);

  if (hidden) return null;

  const done = !!dept?.report;
  return (
    <button
      onClick={() => router.push('/closing-report')}
      className={`w-full mt-3 rounded-2xl border p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform ${
        done ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
      }`}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden>🌙</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-bold text-gray-900">
          {done ? 'Closing Report submitted ✓' : 'Fill in the Closing Report'}
        </span>
        <span className="block text-[12.5px] text-gray-500 mt-0.5">
          {done && dept?.report
            ? `${fmtTimeBerlin(dept.report.submitted_at)} by ${dept.report.submitted_by_name}`
            : 'The last step of closing — a few taps, under a minute'}
        </span>
      </span>
      <span className={`flex-shrink-0 text-[11.5px] font-bold rounded-full px-2.5 py-1 ${done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
        {done ? 'Done' : 'Open'}
      </span>
    </button>
  );
}
