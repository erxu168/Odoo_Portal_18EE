'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { apiGet, fmtDayShort } from './common';

interface ClearedItem {
  id: number;
  name: string;
  amount: number | null;
  unit: string | null;
  location_text: string | null;
  prepared_on: string | null;
  reason: string | null;
  cleared_by_name: string | null;
  cleared_at: string | null;
}
interface History {
  window_days: number;
  tally: { used_up: number; moved_out: number; discarded: number };
  items: ClearedItem[];
}

const REASON: Record<string, { label: string; cls: string }> = {
  used_up: { label: 'Used up', cls: 'bg-green-100 text-green-700' },
  moved_out: { label: 'Moved out', cls: 'bg-blue-100 text-blue-700' },
  discarded: { label: 'Discarded', cls: 'bg-red-100 text-red-700' },
};

/** Berlin-local 'YYYY-MM-DD' for an ISO instant (kitchens run on Berlin time). */
function berlinDay(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}
/** Berlin-local "HH:MM" — a remote/misconfigured device still reads Berlin time. */
function berlinTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}
function todayBerlin(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}
function dayLabel(day: string): string {
  const today = todayBerlin();
  if (day === today) return 'Today';
  const y = new Date(`${today}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return 'Yesterday';
  return fmtDayShort(day);
}

export function ClearedHistory({ companyPill, onBack }: { companyPill?: React.ReactNode; onBack: () => void }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet('/api/shift-handover/storage/history')
      .then((d: History) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the history.'));
  }, []);

  // Group items by their Berlin day, preserving the newest-first order.
  const groups: Array<{ day: string; items: ClearedItem[] }> = [];
  for (const it of data?.items ?? []) {
    const day = it.cleared_at ? berlinDay(it.cleared_at) : 'unknown';
    let g = groups.find((x) => x.day === day);
    if (!g) { g = { day, items: [] }; groups.push(g); }
    g.items.push(it);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16">
      <AppHeader supertitle="Shift Handover" title="Cleared items" subtitle={`Last ${data?.window_days ?? 7} days`} showBack onBack={onBack} action={companyPill} />

      <div className="flex-1 px-4 py-4">
        {error ? (
          <EmptyState icon="⚠️" title="Couldn’t load the history" body={error} />
        ) : !data ? <Spinner /> : data.items.length === 0 ? (
          <EmptyState icon="🧊" title="Nothing cleared yet" body="When staff clear a prepped item, it shows here with what happened to it." />
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <Tally n={data.tally.used_up} label="Used up" cls="text-green-700" />
              <Tally n={data.tally.moved_out} label="Moved out" cls="text-blue-700" />
              <Tally n={data.tally.discarded} label="Discarded" cls="text-red-700" />
            </div>

            {groups.map((g) => (
              <div key={g.day}>
                <p className="text-[10px] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2 px-1">{dayLabel(g.day)}</p>
                <div className="flex flex-col gap-2">
                  {g.items.map((it) => {
                    const r = it.reason ? REASON[it.reason] : null;
                    return (
                      <div key={it.id} className="bg-white border border-gray-200 rounded-xl p-3 flex gap-2.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full flex-shrink-0 self-start ${r?.cls || 'bg-gray-100 text-gray-600'}`}>{r?.label || 'Cleared'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--fs-sm)] font-bold text-gray-900">
                            {it.name}
                            {it.amount != null && it.unit && <span className="text-[var(--fs-xs)] font-semibold text-gray-400 ml-1.5">{it.amount} {it.unit}</span>}
                          </div>
                          {it.location_text && <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">📍 {it.location_text}</div>}
                          <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">
                            {it.cleared_by_name ? `by ${it.cleared_by_name}` : ''}{it.cleared_at ? ` · ${berlinTime(it.cleared_at)}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Tally({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-xl py-2.5 text-center">
      <div className={`text-[18px] font-extrabold leading-none ${cls}`}>{n}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mt-1">{label}</div>
    </div>
  );
}
