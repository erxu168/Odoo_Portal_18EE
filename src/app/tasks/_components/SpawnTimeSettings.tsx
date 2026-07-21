'use client';

/**
 * Per-restaurant daily-checklist spawn time card for /tasks/admin.
 * Reads/writes res.company.kw_task_spawn_hour via /api/tasks/admin/spawn-time.
 * The Odoo cron runs hourly and creates each restaurant's lists on the first
 * pass at or after its configured hour (Europe/Berlin).
 */

import { useCallback, useEffect, useState } from 'react';

interface CompanyRow {
  id: number;
  name: string;
  spawn_hour: number;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export default function SpawnTimeSettings() {
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
      const res = await fetch('/api/tasks/admin/spawn-time', { cache: 'no-store' });
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

  const setHour = (id: number, hour: number) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, spawn_hour: hour } : r)));
    setDirty(true);
    setSavedAt(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/admin/spawn-time', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: rows.map(r => ({ id: r.id, spawn_hour: r.spawn_hour })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      // The save may have partially applied — re-sync with what Odoo has,
      // then surface the error (load() clears it, so set it afterwards).
      await load();
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Daily checklist</p>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <p className="font-semibold text-sm text-gray-800">Checklist creation time</p>
          <p className="text-xs text-gray-400 mt-0.5">
            When each restaurant&apos;s daily checklists are created (Berlin time).
            Lists appear within the hour after the chosen time.
          </p>
        </div>

        {loading ? (
          <p className="px-4 py-5 text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          !error && (
            <p className="px-4 py-5 text-sm text-gray-400">
              No restaurants with departments found — add a department in Odoo first.
            </p>
          )
        ) : (
          <>
            {rows.map((row, i) => (
              <div
                key={row.id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <p className="font-semibold text-sm text-gray-800 min-w-0 truncate">{row.name}</p>
                <select
                  value={row.spawn_hour}
                  onChange={e => setHour(row.id, Number(e.target.value))}
                  disabled={saving}
                  aria-label={`Checklist creation time for ${row.name}`}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  {HOURS.map(h => (
                    <option key={h} value={h}>{hourLabel(h)}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="px-4 py-3.5 border-t border-gray-100 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {savedAt && !dirty && <span className="text-xs font-semibold text-green-600">Saved ✓</span>}
            </div>
          </>
        )}

        {error && (
          <p className="px-4 py-3.5 text-xs font-semibold text-red-600" role="alert">{error}</p>
        )}
      </div>
    </section>
  );
}
