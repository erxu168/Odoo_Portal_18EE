'use client';

import React, { useState, useEffect } from 'react';

/**
 * Manage product categories — add, rename and delete, straight through to Odoo
 * (the shared source of truth, so a change here shows in Odoo and vice-versa).
 * A category still used by products or holding sub-categories can't be deleted
 * (the server says why). Renaming changes the category's own name; its full path
 * (Parent / Child) updates automatically.
 */
interface Cat { id: number; name: string; complete_name: string }

export default function ManageCategories({ onClose, onChanged, baseZ = 130 }: {
  onClose: () => void;
  onChanged: () => void;
  baseZ?: number;
}) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  async function load() {
    try {
      const d = await fetch('/api/inventory/categories').then((r) => r.json());
      setCats(d.categories || []);
    } catch { setErr('Could not load categories.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const name = adding.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not add'); return; }
      setAdding('');
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  async function rename(id: number) {
    const name = editVal.trim();
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/categories', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not rename'); return; }
      setEditId(null);
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  async function del(c: Cat) {
    if (busy) return;
    if (!confirm(`Remove the category “${c.complete_name}”?`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/categories?id=${c.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not delete'); return; }
      await load(); onChanged();
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label="Manage categories">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Categories</h3>
            <p className="text-[var(--fs-xs)] text-gray-500">Edit here or in Odoo — they stay in sync</p>
          </div>
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Done</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {err && <p className="text-[12px] font-semibold text-red-600 mb-2">{err}</p>}
          {loading ? (
            <p className="text-center text-gray-400 py-6 text-[var(--fs-sm)]">Loading…</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {cats.map((c) => {
                const isEditing = editId === c.id;
                return (
                  <div key={c.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    {isEditing ? (
                      <>
                        <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') rename(c.id); if (e.key === 'Escape') setEditId(null); }}
                          disabled={busy}
                          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-green-500" />
                        <button onClick={() => rename(c.id)} disabled={busy || !editVal.trim()}
                          className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40">Save</button>
                        <button onClick={() => setEditId(null)} disabled={busy}
                          className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold text-gray-800">{c.complete_name}</span>
                        <button onClick={() => { setEditId(c.id); setEditVal(c.name); setErr(null); }} disabled={busy}
                          aria-label={`Rename ${c.name}`} className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Rename</button>
                        <button onClick={() => del(c)} disabled={busy} aria-label={`Delete ${c.name}`}
                          className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                      </>
                    )}
                  </div>
                );
              })}
              {cats.length === 0 && <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">No categories yet — add one below.</p>}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
          <input value={adding} onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="New category name…"
            className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-green-500" />
          <button onClick={add} disabled={busy || !adding.trim()}
            className="px-5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Add</button>
        </div>
      </div>
    </div>
  );
}
