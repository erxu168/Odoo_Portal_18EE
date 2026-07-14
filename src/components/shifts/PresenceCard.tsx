'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * Compact live "Right now" presence card for the shifts dashboard (managers only).
 * Surfaces who is currently clocked in — plus a late warning — directly on the
 * dashboard instead of hiding it behind a tile. Taps through to the full
 * PresenceBoard for the per-person detail.
 *
 * Data: GET /api/shifts/presence (manager-only, derived from Odoo hr.attendance).
 * Auto-refreshes every 45s, matching PresenceBoard, so a late arrival surfaces
 * without a reload.
 */

type PresenceState = 'present' | 'late' | 'due' | 'upcoming' | 'done';

interface PresenceRow {
  employeeName: string;
  state: PresenceState;
  minsLate: number;
}

interface PresenceCardProps {
  companyId: number;
  onOpen: () => void;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

export default function PresenceCard({ companyId, onOpen }: PresenceCardProps) {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchPresence = useCallback(async () => {
    try {
      const res = await fetch(`/api/shifts/presence?company_id=${companyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    fetchPresence();
    const timer = setInterval(fetchPresence, 45000);
    return () => clearInterval(timer);
  }, [companyId, fetchPresence]);

  const present = rows.filter((r) => r.state === 'present');
  const late = rows.filter((r) => r.state === 'late');
  const scheduled = rows.length;
  const inNames = present.map((r) => firstName(r.employeeName)).join(', ');
  const lateNames = late.map((r) => firstName(r.employeeName)).join(', ');

  return (
    <button
      onClick={onOpen}
      aria-label="Who is here right now"
      className="w-full text-left rounded-2xl border border-gray-200 bg-white shadow-sm px-4 py-3.5 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-70 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <span className="text-[var(--fs-md)] font-bold text-gray-900">Right now</span>
        </div>
        <div className="text-[var(--fs-sm)] font-bold tabular-nums flex-shrink-0">
          <span className="text-gray-900">{present.length} in</span>
          {late.length > 0 && (
            <span className="text-red-600"> {'·'} {late.length} late</span>
          )}
        </div>
      </div>

      <div className="mt-1.5 text-[var(--fs-sm)] text-gray-600 truncate">
        {loading ? (
          'Checking who’s in…'
        ) : error ? (
          'Couldn’t load — tap to open'
        ) : scheduled === 0 ? (
          'No one scheduled today'
        ) : present.length > 0 ? (
          <>
            In: <span className="font-semibold text-gray-800">{inNames}</span>
          </>
        ) : (
          'Nobody clocked in yet'
        )}
      </div>

      {!loading && !error && late.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[var(--fs-sm)] text-red-700">
          <span aria-hidden="true">{'⚠'}</span>
          <span className="truncate font-semibold">
            {late.length === 1
              ? `${firstName(late[0].employeeName)} — ${late[0].minsLate} min late`
              : `${lateNames} not checked in`}
          </span>
        </div>
      )}

      <div className="mt-2 text-[var(--fs-xs)] font-semibold text-green-700">
        Tap for details {'→'}
      </div>
    </button>
  );
}
