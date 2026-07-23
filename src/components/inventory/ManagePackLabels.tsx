'use client';

import React, { useState, useEffect, useRef } from 'react';

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
  const [labels, setLabels] = useState<{ id: number; label: string; in_use?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [mergeFrom, setMergeFrom] = useState<number | null>(null);   // unit being merged away
  const [mergeInto, setMergeInto] = useState<number>(0);             // target unit id
  const [expanded, setExpanded] = useState<number | null>(null);     // unit whose product list is shown
  const [prodCache, setProdCache] = useState<Record<string, { id: number; name: string }[] | 'loading' | 'error'>>({});
  // Bumped whenever the unit list mutates; an in-flight product fetch from an
  // earlier generation is dropped so it can't repopulate the cache with
  // pre-mutation (stale) data after load() clears it.
  const genRef = useRef(0);

  async function loadProducts(label: string, force = false) {
    if (!force && prodCache[label] && prodCache[label] !== 'error') return;   // cached / loading
    const gen = genRef.current;
    setProdCache((c) => ({ ...c, [label]: 'loading' }));
    try {
      const res = await fetch(`/api/inventory/pack-labels/products?label=${encodeURIComponent(label)}`);
      if (genRef.current !== gen) return;   // list changed while loading — drop this result
      if (!res.ok) { setProdCache((c) => ({ ...c, [label]: 'error' })); return; }
      const d = await res.json();
      if (genRef.current !== gen) return;
      setProdCache((c) => ({ ...c, [label]: d.products || [] }));
    } catch {
      if (genRef.current === gen) setProdCache((c) => ({ ...c, [label]: 'error' }));   // NOT the same as "no products"
    }
  }
  function ProductChips({ label }: { label: string }) {
    const p = prodCache[label];
    if (p === undefined || p === 'loading') return <div className="text-[11px] text-gray-400 px-1 py-0.5">Loading…</div>;
    if (p === 'error') return (
      <div className="text-[11px] text-red-600 px-1 py-0.5">Couldn{'’'}t load the products. <button onClick={() => loadProducts(label, true)} className="font-bold underline">Retry</button></div>
    );
    if (p.length === 0) return <div className="text-[11px] text-gray-400 px-1 py-0.5">No products.</div>;
    return (
      <div className="flex flex-wrap gap-1 px-1 py-0.5">
        {p.map((x) => <span key={x.id} className="text-[11px] bg-white border border-gray-200 rounded-md px-1.5 py-0.5 text-gray-600">{x.name}</span>)}
      </div>
    );
  }

  async function load() {
    try {
      const d = await fetch('/api/inventory/pack-labels').then((r) => r.json());
      setLabels(d.labels || []);
      // A mutation (add/rename/merge/delete) changes which products map to which
      // unit, so invalidate in-flight fetches (genRef), drop the product-list
      // cache + collapse — re-expanding refetches fresh (a renamed unit's new
      // label would otherwise stick on "Loading…", and a late in-flight response
      // could otherwise repopulate stale data).
      genRef.current += 1;
      setProdCache({});
      setExpanded(null);
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

  async function doMerge(fromId: number) {
    if (!mergeInto || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/pack-labels/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_id: fromId, into_id: mergeInto }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not move'); return; }
      setMergeFrom(null); setMergeInto(0);
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
                const isMerging = mergeFrom === l.id;
                const inUse = l.in_use ?? 0;
                return (
                  <div key={l.id} className="flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value.slice(0, 24))}
                          onKeyDown={(e) => { if (e.key === 'Enter') rename(l.id); if (e.key === 'Escape') setEditId(null); }}
                          disabled={busy}
                          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-green-500" />
                        <button onClick={() => rename(l.id)} disabled={busy || !editVal.trim()}
                          className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40">Save</button>
                        <button onClick={() => setEditId(null)} disabled={busy}
                          className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                      </div>
                    ) : isMerging ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[13px] text-gray-700">Move the {inUse} product{inUse === 1 ? '' : 's'} counted in <b>{l.label}</b> to:</div>
                        <ProductChips label={l.label} />
                        <div className="flex items-center gap-2">
                          <select value={mergeInto || ''} onChange={(e) => setMergeInto(Number(e.target.value))} disabled={busy}
                            className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-green-500">
                            <option value="">Pick a unit…</option>
                            {labels.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                          <button onClick={() => doMerge(l.id)} disabled={busy || !mergeInto || !Array.isArray(prodCache[l.label])}
                            title={!Array.isArray(prodCache[l.label]) ? 'Wait for the affected products to load first' : undefined}
                            className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40 whitespace-nowrap">Move &amp; remove</button>
                          <button onClick={() => { setMergeFrom(null); setMergeInto(0); }} disabled={busy}
                            className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-[var(--fs-base)] font-semibold text-gray-800">{l.label}</div>
                            {inUse > 0 && (
                              <button onClick={() => { const next = expanded === l.id ? null : l.id; setExpanded(next); if (next !== null) loadProducts(l.label); }}
                                className="text-[11px] text-blue-600 active:opacity-70">
                                used by {inUse} product{inUse === 1 ? '' : 's'} {expanded === l.id ? '▾' : '▸'}
                              </button>
                            )}
                          </div>
                          {isAdmin && (
                            <>
                              <button onClick={() => { setEditId(l.id); setEditVal(l.label); setErr(null); }} disabled={busy}
                                aria-label={`Rename ${l.label}`} className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Rename</button>
                              {inUse > 0 ? (
                                <button onClick={() => { setMergeFrom(l.id); setMergeInto(0); setErr(null); loadProducts(l.label); }} disabled={busy}
                                  aria-label={`Merge ${l.label} into another unit`}
                                  className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2 whitespace-nowrap">Merge…</button>
                              ) : (
                                <button onClick={() => del(l.id)} disabled={busy} aria-label={`Delete ${l.label}`}
                                  className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                              )}
                            </>
                          )}
                        </div>
                        {expanded === l.id && inUse > 0 && <ProductChips label={l.label} />}
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
