'use client';

import React, { useState, useEffect } from 'react';

/**
 * Manage the "Count by" units (piece/bunch/crate…) — the options in every
 * product's count-by dropdown. This list is GLOBAL: one value per shared product
 * (product_flags.pack_label), so a change here affects EVERY restaurant. Writes
 * are therefore ADMIN-only; everyone else sees a read-only list. A unit still
 * used by a product can't be deleted; renaming cascades to those products.
 */
export default function ManagePackLabels({ onClose, onChanged, baseZ = 130 }: {
  onClose: () => void;
  /** Fired after any add/rename/delete so the opener can refresh its dropdown. */
  onChanged: () => void;
  baseZ?: number;
}) {
  const [labels, setLabels] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  async function load() {
    try {
      const d = await fetch('/api/inventory/pack-labels').then((r) => r.json());
      setLabels(d.labels || []);
    } catch { setErr('Could not load the units.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      setIsAdmin(d?.user?.role === 'admin');
    }).catch(() => {});
  }, []);

  async function add() {
    const label = adding.trim();
    if (!label || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/pack-labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not add'); return; }
      setAdding('');
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  async function rename(id: number) {
    const label = editVal.trim();
    if (!label || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/pack-labels', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, label }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not rename'); return; }
      setEditId(null);
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  async function del(id: number) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/pack-labels?id=${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not delete'); return; }
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label="Manage count-by units">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Count-by units</h3>
            <p className="text-[var(--fs-xs)] text-gray-500">The units staff can count in</p>
          </div>
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Done</button>
        </div>

        {/* Blast-radius warning: this list is shared across every restaurant. */}
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 font-medium flex gap-2">
          <span aria-hidden>⚠️</span>
          <span>These units are <b>shared across all your restaurants</b> — a change here affects every restaurant and every product counted in that unit.{!isAdmin && ' Only an admin can change them.'}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {err && <p className="text-[12px] font-semibold text-red-600 mb-2">{err}</p>}
          {loading ? (
            <p className="text-center text-gray-400 py-6 text-[var(--fs-sm)]">Loading…</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {labels.map((l) => {
                const isEditing = editId === l.id;
                return (
                  <div key={l.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    {isEditing ? (
                      <>
                        <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value.slice(0, 24))}
                          onKeyDown={(e) => { if (e.key === 'Enter') rename(l.id); if (e.key === 'Escape') setEditId(null); }}
                          disabled={busy}
                          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-green-500" />
                        <button onClick={() => rename(l.id)} disabled={busy || !editVal.trim()}
                          className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40">Save</button>
                        <button onClick={() => setEditId(null)} disabled={busy}
                          className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold text-gray-800">{l.label}</span>
                        {isAdmin && (
                          <>
                            <button onClick={() => { setEditId(l.id); setEditVal(l.label); setErr(null); }} disabled={busy}
                              aria-label={`Rename ${l.label}`} className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Rename</button>
                            <button onClick={() => del(l.id)} disabled={busy} aria-label={`Delete ${l.label}`}
                              className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {labels.length === 0 && <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">No units yet{isAdmin ? ' — add one below.' : '.'}</p>}
            </div>
          )}
        </div>

        {isAdmin ? (
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <input value={adding} onChange={(e) => setAdding(e.target.value.slice(0, 24))}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="New unit (e.g. tub, sack)…"
              className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-green-500" />
            <button onClick={add} disabled={busy || !adding.trim()}
              className="px-5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Add</button>
          </div>
        ) : (
          <div className="px-4 py-3 border-t border-gray-100 text-center text-[12px] text-gray-400">
            Ask an admin to add, rename or remove a unit.
          </div>
        )}
      </div>
    </div>
  );
}
