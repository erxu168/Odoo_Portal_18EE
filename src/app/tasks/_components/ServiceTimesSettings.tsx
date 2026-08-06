'use client';

/**
 * Settings → Service times. When Opening / Service / Closing start and end.
 *
 * Why this exists: those three were labels with no time attached, so a task with
 * no deadline of its own could never be called late or remind anyone. Give the
 * periods real times and that task becomes due when its period ends — which
 * makes the overdue count, the kitchen-display reminder and the end-of-day
 * summary work for it, with no separate reminder machinery.
 *
 * The periods run BACK TO BACK, so a day is FOUR boundaries rather than three
 * start/end pairs. A gap or an overlap cannot be expressed, and the only rule
 * left is that the four run in order.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ServiceDayRow } from '@/lib/odoo-tasks';

const WEEKDAYS: { value: string; label: string }[] = [
  { value: '0', label: 'Monday' }, { value: '1', label: 'Tuesday' },
  { value: '2', label: 'Wednesday' }, { value: '3', label: 'Thursday' },
  { value: '4', label: 'Friday' }, { value: '5', label: 'Saturday' },
  { value: '6', label: 'Sunday' },
];

const BOUNDARIES: { key: keyof ServiceDayRow; label: string; hint: string }[] = [
  { key: 'day_start', label: 'Day starts', hint: 'Opening tasks start here' },
  { key: 'opening_end', label: 'Opening ends', hint: 'Service starts here' },
  { key: 'service_end', label: 'Service ends', hint: 'Closing starts here' },
  { key: 'day_end', label: 'Day ends', hint: 'Closing tasks are due by here' },
];

function toHHMM(v: number): string {
  if (v == null || Number.isNaN(v)) return '';
  const h = Math.min(23, Math.floor(v));
  const m = Math.round((v - Math.floor(v)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m >= 60 ? 0 : m).padStart(2, '0')}`;
}
function toFloat(s: string): number {
  const [h, m] = (s || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h + m / 60;
}

const DEFAULT_ROW = (companyId: number, weekday: string): ServiceDayRow => ({
  company_id: companyId, weekday,
  day_start: 8, opening_end: 12, service_end: 17, day_end: 23,
});

interface CompanyBlock {
  id: number;
  name: string;
  rows: ServiceDayRow[];   // exactly one with weekday '' (the default) + overrides
}

export default function ServiceTimesSettings() {
  const [blocks, setBlocks] = useState<CompanyBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stRes, coRes] = await Promise.all([
        fetch('/api/tasks/admin/service-times', { cache: 'no-store' }),
        fetch('/api/tasks/admin/summary-settings', { cache: 'no-store' }),
      ]);
      const st = await stRes.json().catch(() => ({}));
      const co = await coRes.json().catch(() => ({}));
      if (!stRes.ok || !st.ok) throw new Error(st.error || 'Could not load service times');
      const rows: ServiceDayRow[] = st.rows || [];
      // The company list comes from the summary settings endpoint, which already
      // answers "restaurants that actually run task lists" — one definition, not two.
      const companies: { id: number; name: string }[] = co.companies || [];
      setBlocks(companies.map(c => {
        const mine = rows.filter(r => r.company_id === c.id);
        const base = mine.find(r => !r.weekday) || DEFAULT_ROW(c.id, '');
        const overrides = mine.filter(r => r.weekday).sort((a, b) => a.weekday.localeCompare(b.weekday));
        return { id: c.id, name: c.name, rows: [base, ...overrides] };
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load service times');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patch(companyId: number, idx: number, key: keyof ServiceDayRow, value: number) {
    setSavedId(null);
    setBlocks(prev => prev.map(b => b.id !== companyId ? b : {
      ...b, rows: b.rows.map((r, i) => i === idx ? { ...r, [key]: value } : r),
    }));
  }

  function addOverride(companyId: number) {
    setBlocks(prev => prev.map(b => {
      if (b.id !== companyId) return b;
      const used = new Set(b.rows.map(r => r.weekday));
      const next = WEEKDAYS.find(d => !used.has(d.value));
      if (!next) return b;
      const base = b.rows[0];
      return { ...b, rows: [...b.rows, { ...base, weekday: next.value }] };
    }));
  }

  function removeOverride(companyId: number, idx: number) {
    setBlocks(prev => prev.map(b => b.id !== companyId ? b : {
      ...b, rows: b.rows.filter((_, i) => i !== idx),
    }));
  }

  /** Same rule the server enforces, said before a round trip. */
  function rowProblem(r: ServiceDayRow): string | null {
    if (!(r.day_start < r.opening_end && r.opening_end < r.service_end && r.service_end < r.day_end)) {
      return 'Times must run in order down the list.';
    }
    return null;
  }

  async function save(block: CompanyBlock) {
    const bad = block.rows.map(rowProblem).find(Boolean);
    if (bad) { setError(bad); return; }
    setSavingId(block.id);
    setError(null);
    try {
      const res = await fetch('/api/tasks/admin/service-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: block.id, rows: block.rows }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not save');
      setSavedId(block.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="h-24 bg-gray-200 rounded-2xl animate-pulse" />;
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4">
      <p className="font-semibold text-[var(--fs-sm)] text-gray-800">Service times</p>
      <p className="text-[var(--fs-xs)] text-gray-500 mt-0.5 leading-snug">
        When each part of the day runs. A task with no time of its own is due when
        its period ends — so it can still be reminded about and counted as overdue.
        Leave this unset and nothing changes.
      </p>

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[var(--fs-xs)] font-semibold text-red-700">
          {error}
        </p>
      )}

      {blocks.length === 0 && (
        <p className="text-[var(--fs-xs)] text-gray-400 mt-3">No restaurants with task lists yet.</p>
      )}

      {blocks.map(block => (
        <div key={block.id} className="mt-4 pt-4 border-t border-gray-100 first:border-t-0">
          <p className="font-semibold text-[var(--fs-sm)] text-gray-800 mb-2">{block.name}</p>

          {block.rows.map((row, idx) => (
            <div key={`${row.weekday}-${idx}`} className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400">
                  {row.weekday ? WEEKDAYS.find(d => d.value === row.weekday)?.label : 'Every day'}
                </p>
                {row.weekday ? (
                  <button
                    type="button"
                    onClick={() => removeOverride(block.id, idx)}
                    className="min-h-[32px] px-2 text-[var(--fs-xs)] font-semibold text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BOUNDARIES.map(b => (
                  <label key={String(b.key)} className="block">
                    <span className="block text-[var(--fs-xs)] text-gray-500">{b.label}</span>
                    <input
                      type="time"
                      value={toHHMM(row[b.key] as number)}
                      onChange={e => patch(block.id, idx, b.key, toFloat(e.target.value))}
                      className="w-full px-3 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="block text-[10px] text-gray-400 mt-0.5">{b.hint}</span>
                  </label>
                ))}
              </div>
              {rowProblem(row) && (
                <p className="text-[var(--fs-xs)] font-semibold text-red-600 mt-1">{rowProblem(row)}</p>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3">
            {block.rows.length <= WEEKDAYS.length && (
              <button
                type="button"
                onClick={() => addOverride(block.id)}
                className="min-h-[44px] text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800"
              >
                + Different on a specific day
              </button>
            )}
            <button
              type="button"
              onClick={() => save(block)}
              disabled={savingId === block.id}
              className="ml-auto min-h-[44px] px-4 rounded-lg bg-green-600 text-white text-[var(--fs-sm)] font-semibold hover:bg-green-700 disabled:opacity-50"
            >
              {savingId === block.id ? 'Saving…' : savedId === block.id ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
