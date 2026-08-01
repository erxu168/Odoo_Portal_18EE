'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import { Sheet, Field, PrimaryButton, ErrorNote, OptionGrid, apiGet, apiSend, useAsync } from './common';
import { EmojiPicker } from './EmojiPicker';

interface LogType { id: number; name: string; emoji: string; is_alert: boolean; is_storage: boolean; sort_order: number }
type Tab = 'types' | 'prepped-items' | 'units';

export function ManageTypes({ companyPill, onBack }: { companyPill?: React.ReactNode; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('types');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <AppHeader supertitle="Shift Handover · Setup" title="Lists" subtitle="Manager" showBack onBack={onBack} action={companyPill} />

      <div className="px-4 pt-3">
        <div className="flex gap-1.5 bg-gray-100 p-1 rounded-xl">
          <TabBtn on={tab === 'types'} onClick={() => setTab('types')}>Log types</TabBtn>
          <TabBtn on={tab === 'prepped-items'} onClick={() => setTab('prepped-items')}>Prepped items</TabBtn>
          <TabBtn on={tab === 'units'} onClick={() => setTab('units')}>Units</TabBtn>
        </div>
      </div>

      <div className="flex-1 px-4 py-4">
        {tab === 'types' && <LogTypesTab />}
        {tab === 'prepped-items' && <LookupListEditor kind="prepped-items" noun="item" hint="The dishes staff pick from when they prep something." />}
        {tab === 'units' && <LookupListEditor kind="units" noun="unit" hint="The units for the amount of a prepped item (e.g. kg, GN 1/1)." />}
      </div>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex-1 h-9 rounded-lg text-[var(--fs-xs)] font-bold ${on ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>{children}</button>
  );
}

// ── Log types tab (emoji chips staff post) ───────────────────────────────────
function LogTypesTab() {
  const [types, setTypes] = useState<LogType[] | null>(null);
  const [editing, setEditing] = useState<LogType | 'new' | null>(null);
  const load = useCallback(() => { apiGet('/api/shift-handover/types').then((d: any) => setTypes(d.types || [])).catch(() => setTypes([])); }, []);
  useEffect(load, [load]);

  return (
    <>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">The buttons staff pick from when they add to the log. Rename them, change the symbol, or add your own.</p>
      {types === null ? <Spinner /> : (
        <div className="flex flex-col gap-2">
          {types.map((t) => (
            <button key={t.id} onClick={() => setEditing(t)} className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3 flex items-center gap-3 active:bg-gray-50">
              <div className="w-9 h-9 rounded-xl bg-gray-100 grid place-items-center text-[18px] flex-shrink-0" aria-hidden="true">{t.emoji}</div>
              <span className="flex-1 text-[var(--fs-sm)] font-semibold text-gray-900">{t.name}</span>
              {t.is_alert && <span className="text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Alert</span>}
              {t.is_storage && <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Storage</span>}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ))}
          <button onClick={() => setEditing('new')} className="mt-2 w-full h-12 rounded-2xl border-[1.5px] border-dashed border-green-500 text-green-700 font-semibold text-[var(--fs-sm)] flex items-center justify-center gap-2 active:bg-green-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New type
          </button>
        </div>
      )}
      {editing && <TypeSheet type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function TypeSheet({ type, onClose, onSaved }: { type: LogType | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!type;
  const [name, setName] = useState(type?.name ?? '');
  const [emoji, setEmoji] = useState(type?.emoji ?? '📝');
  const [isAlert, setIsAlert] = useState(!!type?.is_alert);
  const { busy, error, setError, run } = useAsync();

  async function save() {
    if (!name.trim()) { setError('Give the type a name.'); return; }
    const res = isEdit
      ? await run(() => apiSend(`/api/shift-handover/types/${type!.id}`, 'PATCH', { name, emoji, is_alert: isAlert }))
      : await run(() => apiSend('/api/shift-handover/types', 'POST', { name, emoji, is_alert: isAlert }));
    if (res) onSaved();
  }
  async function del() {
    if (!type) return;
    if (!window.confirm(`Remove “${type.name}”? Notes already posted keep their label.`)) return;
    const res = await run(() => apiSend(`/api/shift-handover/types/${type.id}`, 'DELETE'));
    if (res) onSaved();
  }

  return (
    <Sheet title={isEdit ? 'Edit type' : 'New type'} onClose={onClose} dismissOnBackdrop={false}
      footer={<PrimaryButton onClick={save} busy={busy}>{isEdit ? 'Save' : 'Add type'}</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex items-end gap-3 mb-4">
        <div className="w-14 h-14 rounded-2xl bg-green-50 border-[1.5px] border-green-500 grid place-items-center text-[26px] flex-shrink-0" aria-hidden="true">{emoji}</div>
        <div className="flex-1">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deliveries"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" /></Field>
        </div>
      </div>
      <div className="mb-4"><EmojiPicker value={emoji} onPick={setEmoji} /></div>
      <Field label="Show as an alert (red)?">
        <OptionGrid cols={2} value={isAlert ? 1 : 0} options={[{ value: 1, label: 'Yes — ask to acknowledge' }, { value: 0, label: 'No' }]} onChange={(v) => setIsAlert(!!v)} />
      </Field>
      {type?.is_storage && <p className="text-[var(--fs-xs)] text-gray-400 -mt-1 mb-2">This type also pins items to “In storage now.”</p>}
      {isEdit && (
        <button onClick={del} disabled={busy} className="mt-2 w-full h-11 rounded-xl border border-red-200 text-red-600 font-semibold text-[var(--fs-sm)] active:bg-red-50 disabled:opacity-50">Remove this type</button>
      )}
    </Sheet>
  );
}

// ── Editable lookup list (prepped items / units) ─────────────────────────────
function LookupListEditor({ kind, noun, hint }: { kind: 'prepped-items' | 'units'; noun: string; hint: string }) {
  const base = `/api/shift-handover/lookups/${kind}`;
  const [items, setItems] = useState<{ id: number; name: string }[] | null>(null);
  const [adding, setAdding] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { apiGet(base).then((d: any) => setItems(d.items || [])).catch(() => setErr('Could not load this list.')); }, [base]);
  useEffect(load, [load]);

  async function mutate(method: string, body?: unknown, query = '') {
    setBusy(true); setErr(null);
    try {
      await apiSend(`${base}${query}`, method, body);
      load();
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); return false; }
    finally { setBusy(false); }
  }

  return (
    <>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">{hint}</p>
      {err && <p className="text-[12px] font-semibold text-red-600 mb-2">{err}</p>}
      {items === null ? <Spinner /> : (
        <div className="flex flex-col gap-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
              {editId === it.id ? (
                <>
                  <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value.slice(0, 60))} disabled={busy}
                    onKeyDown={(e) => { if (e.key === 'Enter') mutate('PATCH', { id: it.id, name: editVal }).then((ok) => ok && setEditId(null)); if (e.key === 'Escape') setEditId(null); }}
                    className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-green-500" />
                  <button onClick={() => mutate('PATCH', { id: it.id, name: editVal }).then((ok) => ok && setEditId(null))} disabled={busy || !editVal.trim()}
                    className="text-[13px] font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40">Save</button>
                  <button onClick={() => setEditId(null)} disabled={busy} className="text-[13px] font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold text-gray-800">{it.name}</span>
                  <button onClick={() => { setEditId(it.id); setEditVal(it.name); setErr(null); }} disabled={busy} aria-label={`Rename ${it.name}`}
                    className="text-[13px] font-semibold text-blue-600 active:opacity-70 disabled:opacity-40 px-2">Rename</button>
                  <button onClick={() => mutate('DELETE', undefined, `?id=${it.id}`)} disabled={busy} aria-label={`Delete ${it.name}`}
                    className="text-[13px] font-bold text-red-600 active:opacity-70 disabled:opacity-40 px-2">Delete</button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">Nothing here yet — add one below.</p>}
          <div className="flex gap-2 mt-2">
            <input value={adding} onChange={(e) => setAdding(e.target.value.slice(0, 60))}
              onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) mutate('POST', { name: adding }).then((ok) => ok && setAdding('')); }}
              placeholder={`Add a ${noun}…`} className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-green-500" />
            <button onClick={() => mutate('POST', { name: adding }).then((ok) => ok && setAdding(''))} disabled={busy || !adding.trim()}
              className="px-5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Add</button>
          </div>
        </div>
      )}
    </>
  );
}
