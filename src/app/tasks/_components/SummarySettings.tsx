'use client';

/**
 * Per-restaurant end-of-day summary card for /tasks/admin. Reads/writes
 * res.company.kw_task_summary_enabled + kw_task_summary_hour via
 * /api/tasks/admin/summary-settings. When on, one recap of the day is pushed to
 * that restaurant's managers at (or just after) the chosen Berlin time.
 */

import { useCallback, useEffect, useState } from 'react';

interface CompanyRow {
  id: number;
  name: string;
  enabled: boolean;
  hour: number;
}

/** Float hour (22.5) ⇄ "HH:MM", so the send time can be any minute rather than
 *  one of four fixed choices. */
function hourToHHMM(v: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(v)));
  const m = Math.round((v - Math.floor(v)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m >= 60 ? 0 : m).padStart(2, '0')}`;
}
function hhmmToHour(s: string): number {
  const [h, m] = (s || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 22.5;
  return h + m / 60;
}


export default function SummarySettings() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/admin/summary-settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load settings');
      setRows(data.companies || []);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = (id: number, next: Partial<CompanyRow>) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...next } : r)));
    setDirty(true);
    setSavedAt(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/admin/summary-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: rows.map(r => ({ id: r.id, enabled: r.enabled, hour: r.hour })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      await load();
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400 mb-2">Notifications</p>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <p className="font-semibold text-[var(--fs-sm)] text-gray-800">End-of-day summary</p>
          <p className="text-[var(--fs-xs)] text-gray-400 mt-0.5">
            One evening recap (done / missed / photos to review) pushed to each restaurant&apos;s
            managers. More alerts can be added here later.
          </p>
        </div>

        {loading ? (
          <p className="px-4 py-5 text-[var(--fs-sm)] text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          !error && (
            <p className="px-4 py-5 text-[var(--fs-sm)] text-gray-400">
              No restaurants with departments found — add a department in Odoo first.
            </p>
          )
        ) : (
          <>
            {rows.map((row, i) => (
              <div key={row.id} className={`px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--fs-sm)] text-gray-800 min-w-0 truncate">{row.name}</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-label={`End-of-day summary for ${row.name}`}
                    disabled={saving}
                    onClick={() => patch(row.id, { enabled: !row.enabled })}
                    className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${row.enabled ? 'bg-green-600' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${row.enabled ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {row.enabled && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="text-[var(--fs-xs)] text-gray-500">Send at</span>
                    <input
                      type="time"
                      min="17:00"
                      max="23:45"
                      value={hourToHHMM(row.hour)}
                      onChange={e => patch(row.id, { hour: hhmmToHour(e.target.value) })}
                      disabled={saving}
                      aria-label={`Send time for ${row.name}`}
                      className="border border-gray-200 rounded-lg px-3 min-h-[44px] text-[var(--fs-sm)] bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="text-[var(--fs-xs)] text-gray-400">Berlin time (17:00–23:45) · sent within 15 min of this</span>
                  </div>
                )}
              </div>
            ))}

            <div className="px-4 py-3.5 border-t border-gray-100 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="bg-green-600 text-white text-[var(--fs-sm)] font-semibold px-4 py-2 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {savedAt && !dirty && <span className="text-[var(--fs-xs)] font-semibold text-green-600">Saved ✓</span>}
            </div>
          </>
        )}

        {error && <p className="px-4 py-3.5 text-[var(--fs-xs)] font-semibold text-red-600" role="alert">{error}</p>}
      </div>
    </section>
  );
}
