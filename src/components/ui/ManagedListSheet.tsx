'use client';

import React, { useState, useEffect, useCallback } from 'react';

/**
 * The ONE editor for any registry-listed managed list (delivery-issue types,
 * skip-count reasons, …). Driven entirely by /api/managed-lists/[key]: it renders
 * the items, an add row, and per-item rename/delete — but only the actions the
 * list allows (meta.caps) and only if THIS user may write (meta.canWrite). Shows
 * the list's blast-radius warning when present. Reused inline next to a dropdown
 * and from the central Settings page, so behaviour is identical everywhere.
 */
interface Item { id: number; label: string }
interface Meta { label: string; description: string; warn: string | null; caps: { add: boolean; rename: boolean; delete: boolean }; canWrite: boolean }

export default function ManagedListSheet({ listKey, companyId, onChanged, onClose, baseZ = 130 }: {
  listKey: string;
  /** Required for per-company lists; omit for global ones. */
  companyId?: number;
  onChanged?: () => void;
  onClose: () => void;
  baseZ?: number;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  const qs = companyId ? `?company_id=${companyId}` : '';

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/managed-lists/${listKey}${qs}`).then((r) => r.json());
      setItems(d.items || []);
      setMeta(d.meta || null);
    } catch { setErr('Could not load this list.'); }
    finally { setLoading(false); }
  }, [listKey, qs]);
  useEffect(() => { load(); }, [load]);

  async function mutate(method: string, body?: unknown, query = '') {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/managed-lists/${listKey}${qs}${query ? (qs ? '&' : '?') + query : ''}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Something went wrong'); return false; }
      await load(); onChanged?.();
      return true;
    } catch { setErr('Network error'); return false; }
    finally { setBusy(false); }
  }

  const canWrite = !!meta?.canWrite;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label={`Manage ${meta?.label || 'list'}`}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900 truncate">{meta?.label || 'List'}</h3>
            {meta?.description && <p className="text-[var(--fs-xs)] text-gray-500">{meta.description}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70 flex-shrink-0 ml-3">Done</button>
        </div>

        {meta?.warn && (
          <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800 font-medium flex gap-2">
            <span aria-hidden>⚠️</span>
            <span>{meta.warn}{!canWrite && ' Only an admin can change these.'}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {err && <p className="text-[12px] font-semibold text-red-600 mb-2">{err}</p>}
          {loading ? (
            <p className="text-center text-gray-400 py-6 text-[var(--fs-sm)]">Loading…</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map((it) => {
                const isEditing = editId === it.id;
                return (
                  <div key={it.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    {isEditing ? (
                      <>
                        <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value.slice(0, 60))}
                          onKeyDown={(e) => { if (e.key === 'Enter') mutate('PATCH', { id: it.id, label: editVal }).then((ok) => ok && setEditId(null)); if (e.key === 'Escape') setEditId(null); }}
                          disabled={busy}
                          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-green-500" />
                        <button onClick={() => mutate('PATCH', { id: it.id, label: editVal }).then((ok) => ok && setEditId(null))} disabled={busy || !editVal.trim()}
                          className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40">Save</button>
                        <button onClick={() => setEditId(null)} disabled={busy}
                          className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold text-gray-800">{it.label}</span>
                        {canWrite && meta?.caps.rename && (
                          <button onClick={() => { setEditId(it.id); setEditVal(it.label); setErr(null); }} disabled={busy}
                            aria-label={`Rename ${it.label}`} className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Rename</button>
                        )}
                        {canWrite && meta?.caps.delete && (
                          <button onClick={() => mutate('DELETE', undefined, `id=${it.id}`)} disabled={busy}
                            aria-label={`Delete ${it.label}`} className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">Nothing here yet{canWrite && meta?.caps.add ? ' — add one below.' : '.'}</p>}
            </div>
          )}
        </div>

        {canWrite && meta?.caps.add ? (
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <input value={adding} onChange={(e) => setAdding(e.target.value.slice(0, 60))}
              onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) mutate('POST', { label: adding }).then((ok) => ok && setAdding('')); }}
              placeholder="Add a new one…"
              className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-green-500" />
            <button onClick={() => mutate('POST', { label: adding }).then((ok) => ok && setAdding(''))} disabled={busy || !adding.trim()}
              className="px-5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Add</button>
          </div>
        ) : !loading && (
          <div className="px-4 py-3 border-t border-gray-100 text-center text-[12px] text-gray-400">
            Ask an admin to change this list.
          </div>
        )}
      </div>
    </div>
  );
}
