'use client';

/**
 * Choosing a product category, and creating or moving one.
 *
 * The old control was a flat <select> of 46 leaf names: "Sauces" told you
 * nothing about whether it hangs off Central Kitchen Products or somewhere
 * else, four levels of tree all printed flush left. This walks the branch
 * instead, and the create/move form asks for a parent the way Odoo's own
 * category form does.
 *
 * CAREFUL with names: a category may contain the path separator IN ITS NAME —
 * "Drinks / Soft Drinks" is one category, not two levels. So the tree is built
 * from parent_id, never by splitting complete_name, and the branch shown above
 * a name is whatever complete_name has in front of that exact name.
 */

import React, { useMemo, useState } from 'react';
import { TreePickerSheet, type TreeNode } from '@/components/ui/LocationPickerSheet';

export interface CategoryRow {
  id: number;
  name: string;
  complete_name?: string;
  parent_id?: number | null;
}

/** The branch a category sits on, derived without ever splitting on "/". */
export function categoryBranch(c: CategoryRow): string {
  const full = String(c.complete_name || c.name);
  const leaf = String(c.name || full);
  return full.endsWith(leaf)
    ? full.slice(0, full.length - leaf.length).replace(/\s*\/\s*$/, '')
    : '';
}

/**
 * complete_name is the only hierarchy Odoo hands us on this endpoint, so the
 * parent is resolved by finding the category whose full path is exactly this
 * one's branch. Names containing "/" survive because both sides are compared
 * whole, never split.
 */
export function withParents(cats: CategoryRow[]): (TreeNode & { complete_name: string })[] {
  const byFull = new Map<string, number>();
  cats.forEach((c) => byFull.set(String(c.complete_name || c.name), c.id));
  return cats.map((c) => {
    const branch = categoryBranch(c);
    const parent = branch ? byFull.get(branch) ?? null : null;
    return {
      id: c.id,
      name: c.name,
      complete_name: String(c.complete_name || c.name),
      parent_id: parent === c.id ? null : parent,
    };
  });
}

/** The current choice, shown as its branch above and its own name in bold. */
export function CategoryPathButton({
  cats, value, placeholder = 'Choose a category', disabled, onOpen,
}: {
  cats: CategoryRow[];
  value: number | null;
  placeholder?: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const cur = value == null ? null : cats.find((c) => c.id === value) || null;
  const branch = cur ? categoryBranch(cur) : '';
  return (
    <button type="button" onClick={onOpen} disabled={disabled}
      className="w-full min-h-[48px] bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 text-left active:bg-gray-50 disabled:opacity-60">
      <span aria-hidden="true">{cur ? '📂' : '📁'}</span>
      <span className="min-w-0 flex-1">
        {cur ? (
          <>
            {branch && <span className="block text-[var(--fs-xs)] text-gray-400 truncate">{branch}</span>}
            <span className="block text-[var(--fs-base)] font-bold text-gray-900 [overflow-wrap:anywhere]">{cur.name}</span>
          </>
        ) : (
          <span className="block text-[var(--fs-base)] text-gray-400">{placeholder}</span>
        )}
      </span>
      <span className="text-gray-400 font-bold flex-shrink-0">›</span>
    </button>
  );
}

export function CategoryPickerSheet({
  cats, value, onPick, onClose, title = 'Category',
}: {
  cats: CategoryRow[];
  value: number | null;
  onPick: (id: number) => void;
  onClose: () => void;
  title?: string;
}) {
  const nodes = useMemo(() => withParents(cats), [cats]);
  return (
    <TreePickerSheet
      nodes={nodes}
      value={value}
      title={title}
      iconOf={() => '📁'}
      searchLabel="Search all categories"
      emptyLabel="No categories yet."
      useHereLabel={(n) => `Use ${n.name} itself`}
      onPick={(id) => onPick(id)}
      onClose={onClose}
    />
  );
}

/**
 * Name + where it sits, with the resulting path spelled out before you commit.
 * The same form creates a new category and moves an existing one — moving IS
 * changing where it sits, and two screens for that would drift apart.
 */
export function CategoryForm({
  cats, editing, initialParent, busy, onCancel, onSave,
}: {
  cats: CategoryRow[];
  /** null = creating a new one. */
  editing: CategoryRow | null;
  initialParent?: number | null;
  busy?: boolean;
  onCancel: () => void;
  onSave: (name: string, parentId: number | null) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [parentId, setParentId] = useState<number | null>(() => {
    if (editing) {
      const branch = categoryBranch(editing);
      const p = cats.find((c) => String(c.complete_name || c.name) === branch);
      return p ? p.id : null;
    }
    return initialParent ?? null;
  });
  const [picking, setPicking] = useState(false);

  const parent = parentId == null ? null : cats.find((c) => c.id === parentId) || null;
  const parentFull = parent ? String(parent.complete_name || parent.name) : '';
  const preview = `${parentFull ? parentFull + ' / ' : ''}${name.trim() || '…'}`;

  // Moving a category inside itself, or inside one of its own children, would
  // detach the branch. The server refuses too; this just never offers it.
  const banned = useMemo(() => {
    if (!editing) return new Set<number>();
    const out = new Set<number>([editing.id]);
    const mine = String(editing.complete_name || editing.name) + ' / ';
    cats.forEach((c) => { if (String(c.complete_name || c.name).startsWith(mine)) out.add(c.id); });
    return out;
  }, [editing, cats]);
  const pickable = useMemo(() => cats.filter((c) => !banned.has(c.id)), [cats, banned]);

  return (
    <div className="fixed inset-0 z-[130] flex items-end" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onCancel} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full bg-white rounded-t-3xl max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-3">
          <span className="text-[var(--fs-lg)] font-bold text-gray-900">
            {editing ? 'Edit category' : 'New category'}
          </span>
          <button onClick={onCancel} className="ml-auto text-[var(--fs-sm)] font-semibold text-gray-500 active:opacity-70">Cancel</button>
        </div>

        <div className="px-5 py-4">
          <label htmlFor="cf-name" className="block text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-1.5">Name</label>
          <input id="cf-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
            placeholder="e.g. Pickles & Ferments"
            className="w-full h-12 bg-gray-50 border border-gray-200 rounded-xl px-3.5 text-[var(--fs-base)] outline-none focus:border-green-600" />

          <div className="block text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mt-4 mb-1.5">Sits inside</div>
          <CategoryPathButton cats={cats} value={parentId} placeholder="Nothing — a top-level category"
            disabled={busy} onOpen={() => setPicking(true)} />
          {parentId != null && !busy && (
            <button onClick={() => setParentId(null)}
              className="mt-1.5 text-[var(--fs-xs)] font-bold text-gray-500 active:opacity-70">
              Make it top-level instead
            </button>
          )}

          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.06em] text-blue-700 mb-0.5">
              {editing ? 'It will be filed as' : 'It will be created as'}
            </span>
            <span className="block text-[var(--fs-sm)] font-bold text-gray-900 [overflow-wrap:anywhere]">{preview}</span>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button onClick={() => onSave(name.trim(), parentId)} disabled={busy || !name.trim()}
            className="w-full h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
          </button>
        </div>

        {picking && (
          <CategoryPickerSheet
            cats={pickable}
            value={parentId}
            title="Sits inside"
            onPick={(id) => { setParentId(id); setPicking(false); }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </div>
  );
}
