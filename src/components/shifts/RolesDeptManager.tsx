'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { SectionTitle } from '@/components/shifts/ui';

/**
 * Manage a company's planning roles and departments from the portal
 * (Planning → gear). Add, rename (edit + blur/Enter) and delete each; a delete
 * that's still in use is refused by the server with a clear message. Immediate
 * actions — no Save button. Manager-only screen.
 */

interface Item {
  id: number;
  name: string;
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6" />
    </svg>
  );
}

function ListEditor({ label, base, companyId }: { label: string; base: string; companyId: number }) {
  const key = base.endsWith('roles') ? 'roles' : 'departments';
  const singular = label.toLowerCase().replace(/s$/, '');
  const [items, setItems] = useState<Item[]>([]);
  const [orig, setOrig] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}?company_id=${companyId}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d[key])) {
        setItems(d[key]);
        setOrig(Object.fromEntries((d[key] as Item[]).map(x => [x.id, x.name])));
      }
    } catch { /* ignore */ }
  }, [base, companyId, key]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const name = adding.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      setAdding('');
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Could not add the ${singular}`);
    } finally {
      setBusy(false);
    }
  }

  async function rename(item: Item) {
    const name = item.name.trim();
    if (!name || name === orig[item.id]) return;
    setErr(null);
    try {
      const res = await fetch(`${base}/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      setOrig(o => ({ ...o, [item.id]: name }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Could not rename the ${singular}`);
      await load();
    }
  }

  async function remove(id: number) {
    setErr(null);
    try {
      const res = await fetch(`${base}/${id}?company_id=${companyId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : `Could not delete the ${singular}`);
    }
  }

  return (
    <div>
      <SectionTitle>{label}</SectionTitle>
      <div className="mx-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
        {items.length === 0 && (
          <div className="px-4 py-3 text-[var(--fs-sm)] text-gray-400">No {label.toLowerCase()} yet.</div>
        )}
        {items.map((it, i) => (
          <div key={it.id} className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <input
              value={it.name}
              onChange={e => setItems(list => list.map(x => (x.id === it.id ? { ...x, name: e.target.value } : x)))}
              onBlur={() => void rename(it)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="flex-1 min-w-0 bg-transparent outline-none text-[var(--fs-md)] font-semibold text-gray-900"
              aria-label={`${singular} name`}
            />
            <button
              onClick={() => void remove(it.id)}
              aria-label={`Delete ${it.name}`}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:text-red-600 active:bg-red-50 flex-shrink-0"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 bg-gray-50">
          <input
            value={adding}
            onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void add(); }}
            placeholder={`Add a ${singular}…`}
            maxLength={60}
            className="flex-1 min-w-0 bg-transparent outline-none text-[var(--fs-md)] text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={() => void add()}
            disabled={!adding.trim() || busy}
            className="px-3.5 py-1.5 rounded-lg bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-40 flex-shrink-0"
          >
            Add
          </button>
        </div>
      </div>
      {err && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
          {err}
        </div>
      )}
    </div>
  );
}

export default function RolesDeptManager({ companyId }: { companyId: number }) {
  return (
    <>
      <ListEditor label="Roles" base="/api/shifts/roles" companyId={companyId} />
      <ListEditor label="Departments" base="/api/shifts/departments" companyId={companyId} />
    </>
  );
}
