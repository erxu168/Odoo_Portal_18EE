'use client';

import React, { useMemo, useState } from 'react';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import { Sheet, Field, PrimaryButton, ErrorNote, OptionGrid, apiSend, useAsync } from './common';
import type { FeedEntry } from './EntryCard';

export interface LogTypeChip { id: number; name: string; emoji: string; is_alert: boolean; is_storage: boolean }

export function AddEntrySheet({ types, editEntry, onClose, onSaved }: {
  types: LogTypeChip[]; editEntry?: FeedEntry | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!editEntry;
  const [typeId, setTypeId] = useState<number | null>(types[0]?.id ?? null);
  const [note, setNote] = useState(editEntry?.note ?? '');
  const [photos, setPhotos] = useState<string[]>(editEntry?.photos ?? []);
  const [name, setName] = useState('');
  const [where, setWhere] = useState('');
  const [useFirst, setUseFirst] = useState(false);
  const [key] = useState(() => `entry-${Math.round(Math.random() * 1e9)}`);
  const { busy, error, setError, run } = useAsync();

  const selected = useMemo(() => types.find((t) => t.id === typeId) || null, [types, typeId]);
  const isStorage = !isEdit && !!selected?.is_storage;

  async function save() {
    if (isEdit) {
      if (!note.trim() && photos.length === 0) { setError('Add a note or a photo.'); return; }
      const res = await run(() => apiSend(`/api/shift-handover/entries/${editEntry!.id}`, 'PATCH', { note, photos }));
      if (res) onSaved();
      return;
    }
    if (!typeId) { setError('Pick a type first.'); return; }
    if (isStorage && !name.trim()) { setError('What did you store?'); return; }
    if (!note.trim() && photos.length === 0 && !(isStorage && name.trim())) { setError('Add a note or a photo.'); return; }
    const res = await run(() => apiSend('/api/shift-handover/entries', 'POST', {
      type_id: typeId, note, photos,
      storage: isStorage ? { name, location_text: where, use_first: useFirst } : null,
      idempotency_key: key,
    }));
    if (res) onSaved();
  }

  return (
    <Sheet title={isEdit ? 'Edit note' : 'Add to the log'} onClose={onClose}
      footer={<PrimaryButton onClick={save} busy={busy}>{isEdit ? 'Save changes' : 'Post to the log'}</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>

      {!isEdit && (
        <>
          <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">Type</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {types.map((t) => {
              const on = t.id === typeId;
              return (
                <button key={t.id} type="button" onClick={() => setTypeId(t.id)}
                  className={`rounded-2xl border px-1.5 py-2.5 text-center active:scale-95 transition-transform ${on ? 'bg-green-50 border-green-600 ring-1 ring-green-600' : 'bg-white border-gray-200'}`}>
                  <div className="text-[22px] leading-none">{t.emoji}</div>
                  <div className={`text-[var(--fs-xs)] mt-1.5 leading-tight ${on ? 'text-green-800 font-bold' : 'text-gray-600 font-medium'}`}>{t.name}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {isStorage && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 mb-4 flex gap-2">
          <span aria-hidden="true">📌</span>
          <p className="text-[var(--fs-xs)] text-blue-800">This stays pinned in “In storage now” until someone marks it used.</p>
        </div>
      )}

      {isStorage && (
        <>
          <Field label="What is it?">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coleslaw"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
          </Field>
          <Field label="Where is it? (optional)">
            <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. Walk-in · top shelf, left"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
          </Field>
          <Field label="Use this first?">
            <OptionGrid cols={2} value={useFirst ? 1 : 0} options={[{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]} onChange={(v) => setUseFirst(!!v)} />
          </Field>
        </>
      )}

      <Field label={isStorage ? 'Extra note (optional)' : 'Note'}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={isStorage ? 'Anything else the next shift should know' : 'What did you do? What should the next shift know?'}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 min-h-[72px] text-[var(--fs-base)] outline-none focus:border-green-600" />
      </Field>

      <Field label="Photo (optional)">
        <PhotoCaptureStrip photos={photos} onChange={setPhotos} max={3} />
      </Field>
    </Sheet>
  );
}
