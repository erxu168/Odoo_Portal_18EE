'use client';

import React, { useState, useEffect } from 'react';
import { CategoryForm, categoryBranch, type CategoryRow } from './CategoryPicker';

/**
 * Manage product categories — add, edit, move and delete, straight through to
 * Odoo (the shared source of truth, so a change here shows in Odoo and
 * vice-versa). A category still used by products or holding sub-categories
 * can't be deleted (the server says why).
 *
 * Editing opens the same name-and-parent form used on the product page: moving
 * a category IS editing it, and a separate "move" screen would be a second
 * editor for one record.
 */
interface Cat { id: number; name: string; complete_name: string }

export default function ManageCategories({ onClose, onChanged, baseZ = 130 }: {
  onClose: () => void;
  onChanged: () => void;
  baseZ?: number;
}) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const d = await fetch('/api/inventory/categories').then((r) => r.json());
      setCats(d.categories || []);
    } catch { setErr('Could not load categories.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);


  async function save(cat: CategoryRow | null, name: string, parentId: number | null) {
    if (!name || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/inventory/categories', {
        method: cat ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cat ? { id: cat.id, name, parent_id: parentId } : { name, parent_id: parentId }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not save'); return; }
      setEditing(null); setCreating(false);
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
              {cats.map((c) => (
                <div key={c.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 min-h-[48px]">
                  {/* The whole path, always readable. On one truncated line
                      sharing the row with two buttons every sibling read the
                      same up to the point where they differ. The branch sits
                      above in small type; the category itself is the bold line.
                      The branch comes from categoryBranch(), which never splits
                      on "/" — six of these categories have one in their name. */}
                  <span className="flex-1 min-w-0">
                    {categoryBranch(c) && (
                      <span className="block text-[var(--fs-xs)] text-gray-400 leading-snug [overflow-wrap:anywhere]">{categoryBranch(c)}</span>
                    )}
                    <span className="block text-[var(--fs-base)] font-semibold text-gray-800 leading-snug [overflow-wrap:anywhere]">{c.name}</span>
                  </span>
                  <button onClick={() => setEditing(c)} disabled={busy}
                    aria-label={`Edit ${c.name}`}
                    className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Edit</button>
                  <button onClick={() => del(c)} disabled={busy} aria-label={`Delete ${c.name}`}
                    className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                </div>
              ))}
              {cats.length === 0 && <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">No categories yet — add one below.</p>}
            </div>
          )}
        </div>

        {/* One button, not a bare name box: a category typed into a box can only
            ever land at the top level, which is how five "Drinks / …" roots came
            to exist. The form asks where it goes. */}
        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={() => setCreating(true)} disabled={busy}
            className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">
            ＋ New category
          </button>
        </div>
      </div>

      {(creating || editing) && (
        <CategoryForm
          cats={cats}
          editing={editing}
          busy={busy}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSave={(nm, parentId) => save(editing, nm, parentId)}
        />
      )}
    </div>
  );
}
