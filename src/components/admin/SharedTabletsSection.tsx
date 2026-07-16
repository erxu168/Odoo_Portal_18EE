'use client';

import React, { useEffect, useState } from 'react';

interface Tablet {
  id: number;
  company_id: number;
  label: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  disabled: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

/**
 * Manager/admin management of provisioned shared tablets: turn a tablet's access
 * on/off (reversible) or remove its setup entirely — from your own device, no need
 * to hold the tablet. Both cut the tablet's live sessions immediately.
 */
export default function SharedTabletsSection() {
  const [tablets, setTablets] = useState<Tablet[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/admin/tablets');
      if (!res.ok) { setTablets([]); return; }
      const d = await res.json();
      setTablets(d.tablets || []);
    } catch { setTablets([]); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(t: Tablet) {
    setBusy(t.id); setError(null);
    try {
      const res = await fetch(`/api/admin/tablets/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: t.disabled }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setTablets(prev => prev ? prev.map(x => x.id === t.id ? { ...x, disabled: d.disabled } : x) : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function remove(t: Tablet) {
    if (!window.confirm(`Remove the "${t.label || 'tablet'}" setup? That tablet will drop back to the normal email/password login and has to be set up again.`)) return;
    setBusy(t.id); setError(null);
    try {
      const res = await fetch(`/api/admin/tablets/${t.id}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed');
      setTablets(prev => prev ? prev.filter(x => x.id !== t.id) : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  if (tablets === null) return null; // still loading — stay quiet

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="mb-1 text-[15px] font-bold text-gray-900">Shared tablets</div>
      <p className="text-[12px] text-gray-500 mb-3">Turn a kitchen tablet&rsquo;s access on or off, or remove its setup — even a lost one, from here.</p>

      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[12px]">{error}</div>}

      {tablets.length === 0 ? (
        <div className="text-[13px] text-gray-400 py-3">No tablets have been set up yet.</div>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {tablets.map(t => (
            <div key={t.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-gray-900 truncate">{t.label || `Restaurant ${t.company_id}`}</div>
                <div className="text-[12px] text-gray-500 truncate">
                  Set up{t.created_by ? ` by ${t.created_by}` : ''} · {fmt(t.created_at)} · last used {fmt(t.last_used_at)}
                </div>
              </div>

              {/* On/Off access toggle */}
              <button
                onClick={() => toggle(t)}
                disabled={busy === t.id}
                aria-label={t.disabled ? 'Turn access on' : 'Turn access off'}
                className={`relative w-[52px] h-[30px] rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${t.disabled ? 'bg-gray-300' : 'bg-green-600'}`}
              >
                <span className={`absolute top-[3px] w-6 h-6 rounded-full bg-white shadow transition-all ${t.disabled ? 'left-[3px]' : 'left-[23px]'}`} />
              </button>
              <span className={`text-[11px] font-bold w-7 ${t.disabled ? 'text-gray-400' : 'text-green-700'}`}>{t.disabled ? 'Off' : 'On'}</span>

              <button
                onClick={() => remove(t)}
                disabled={busy === t.id}
                className="text-[12px] font-semibold text-red-600 active:opacity-70 disabled:opacity-50 flex-shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
