'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/inventory/ui';
import { Sheet, Field, PrimaryButton, ErrorNote, OptionGrid, apiGet, apiSend, useAsync } from './common';
import { EmojiPicker } from './EmojiPicker';

interface LogType { id: number; name: string; emoji: string; is_alert: boolean; is_storage: boolean; sort_order: number }

export function ManageTypes({ companyPill, onBack }: { companyPill?: React.ReactNode; onBack: () => void }) {
  const [types, setTypes] = useState<LogType[] | null>(null);
  const [editing, setEditing] = useState<LogType | 'new' | null>(null);

  const load = useCallback(() => {
    apiGet('/api/shift-handover/types').then((d: any) => setTypes(d.types || [])).catch(() => setTypes([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <AppHeader supertitle="Shift Handover · Setup" title="Log types" subtitle="Manager" showBack onBack={onBack} action={companyPill} />

      <div className="flex-1 px-4 py-4">
        <p className="text-[var(--fs-sm)] text-gray-500 mb-4">These are the buttons staff pick from when they add to the log. Rename them, change the symbol, or add your own.</p>

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
      </div>

      {editing && (
        <TypeSheet type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
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
    <Sheet title={isEdit ? 'Edit type' : 'New type'} onClose={onClose}
      footer={<PrimaryButton onClick={save} busy={busy}>{isEdit ? 'Save' : 'Add type'}</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>

      <div className="flex items-end gap-3 mb-4">
        <div className="w-14 h-14 rounded-2xl bg-green-50 border-[1.5px] border-green-500 grid place-items-center text-[26px] flex-shrink-0" aria-hidden="true">{emoji}</div>
        <div className="flex-1">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deliveries"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
          </Field>
        </div>
      </div>

      <div className="mb-4"><EmojiPicker value={emoji} onPick={setEmoji} /></div>

      <Field label="Show as an alert (red)?">
        <OptionGrid cols={2} value={isAlert ? 1 : 0} options={[{ value: 1, label: 'Yes — ask to acknowledge' }, { value: 0, label: 'No' }]} onChange={(v) => setIsAlert(!!v)} />
      </Field>
      {type?.is_storage && (
        <p className="text-[var(--fs-xs)] text-gray-400 -mt-1 mb-2">This type also pins items to “In storage now.”</p>
      )}

      {isEdit && (
        <button onClick={del} disabled={busy} className="mt-2 w-full h-11 rounded-xl border border-red-200 text-red-600 font-semibold text-[var(--fs-sm)] active:bg-red-50 disabled:opacity-50">
          Remove this type
        </button>
      )}
    </Sheet>
  );
}
