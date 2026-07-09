'use client';

import React, { useEffect, useState } from 'react';
import { weekKeyDays } from '@/lib/shifts-time';

/**
 * Staff pop-up: when a week has been published for selection, greet the staff
 * member on the Planning dashboard with what they need to do — pick their
 * shifts by the deadline, weekend shifts first. Shown once per publish run
 * (dismissal remembered in localStorage); the Open Shifts banner keeps
 * reminding after that.
 */

interface Announcement {
  show: boolean;
  runId?: number;
  weekKey?: string;
  deadline?: string;
  weekendRequired?: number;
  weekendRemaining?: number;
  openEligible?: number;
}

interface StaffAnnouncementProps {
  companyId: number | null;
  employeeId: number | null;
  onGoOpen: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function weekLabel(weekKey: string | undefined): string {
  if (!weekKey) return 'the coming week';
  try {
    const days = weekKeyDays(weekKey);
    return `${shortDate(days[0])} – ${shortDate(days[6])}`;
  } catch {
    return 'the coming week';
  }
}
function fmtDeadline(iso: string | undefined): string {
  if (!iso) return 'the deadline';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'the deadline';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StaffAnnouncement({ companyId, employeeId, onGoOpen }: StaffAnnouncementProps) {
  const [ann, setAnn] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!companyId || employeeId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shifts/announcement?company_id=${companyId}`);
        const data = (await res.json()) as Announcement;
        if (cancelled || !res.ok || !data.show) return;
        const key = `kwShiftAnn:${data.runId}`;
        if (typeof window !== 'undefined' && window.localStorage.getItem(key)) return;
        setAnn(data);
        setOpen(true);
      } catch {
        /* pop-up is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, employeeId]);

  if (!open || !ann || !ann.show) return null;

  function dismiss() {
    if (ann?.runId != null && typeof window !== 'undefined') {
      window.localStorage.setItem(`kwShiftAnn:${ann.runId}`, '1');
    }
    setOpen(false);
  }
  function pick() {
    dismiss();
    onGoOpen();
  }

  const remaining = ann.weekendRemaining ?? 0;
  const openCount = ann.openEligible ?? 0;

  return (
    <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-5" onClick={dismiss}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="text-3xl mb-2">📢</div>
        <h2 className="text-[var(--fs-xl)] font-bold text-gray-900 mb-1">New shifts to pick</h2>
        <p className="text-[var(--fs-base)] text-gray-600 leading-relaxed mb-3">
          Shifts for the week of <b>{weekLabel(ann.weekKey)}</b> are up. Pick yours by{' '}
          <b>{fmtDeadline(ann.deadline)}</b>.
        </p>
        {remaining > 0 && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-[var(--fs-sm)] text-red-800 mb-3">
            You must take <b>{remaining} weekend shift{remaining === 1 ? '' : 's'}</b> first, then you can pick weekday shifts.
          </div>
        )}
        {openCount > 0 && (
          <p className="text-[var(--fs-sm)] text-gray-600 mb-3">
            <b>{openCount} shift{openCount === 1 ? '' : 's'}</b> {openCount === 1 ? 'is' : 'are'} open for you to pick
            {remaining > 0 ? ' after that' : ''}.
          </p>
        )}
        <button
          onClick={pick}
          className="w-full bg-green-600 text-white font-bold rounded-xl py-3.5 text-[var(--fs-md)] active:bg-green-700 mb-2"
        >
          Pick shifts
        </button>
        <button onClick={dismiss} className="w-full text-gray-500 font-semibold py-2 text-[var(--fs-sm)]">
          Later
        </button>
      </div>
    </div>
  );
}
