'use client';

import React, { useEffect, useMemo, useState } from 'react';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import { Sheet, Field, Select, PrimaryButton, ErrorNote, OptionGrid, apiSend, useAsync, parseAmount } from './common';
import { LocationPickerSheet, LocationPathButton, type PickableLocation } from '@/components/ui/LocationPickerSheet';
import type { FeedEntry } from './EntryCard';

export interface LogTypeChip { id: number; name: string; emoji: string; is_alert: boolean; is_storage: boolean }
export interface NamedLookup { id: number; name: string }

const OTHER = '__other__';

/** Today's date in the Berlin calendar (kitchens run on Berlin time). */
function berlinTodayLocal(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

export function AddEntrySheet({ types, preppedItems, units, editEntry, onClose, onSaved }: {
  types: LogTypeChip[]; preppedItems: NamedLookup[]; units: NamedLookup[];
  editEntry?: FeedEntry | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!editEntry;
  // Default to a plain (non-storage) type so opening "Add" doesn't immediately
  // demand item/amount/unit/place for someone who just wants to leave a note.
  const [typeId, setTypeId] = useState<number | null>((types.find((t) => !t.is_storage) ?? types[0])?.id ?? null);
  const [note, setNote] = useState(editEntry?.note ?? '');
  const [photos, setPhotos] = useState<string[]>(editEntry?.photos ?? []);

  // Prepped-item fields.
  const [itemChoice, setItemChoice] = useState<string>(''); // lookup id as string, or OTHER, or ''
  const [otherName, setOtherName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<string>(units[0]?.name ?? '');
  const [preparedOn, setPreparedOn] = useState<string>(berlinTodayLocal());
  const [whereId, setWhereId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [places, setPlaces] = useState<PickableLocation[]>([]);
  const [useFirst, setUseFirst] = useState(false);

  const [key] = useState(() => `entry-${Math.round(Math.random() * 1e9)}`);
  const { busy, error, setError, run } = useAsync();

  const selected = useMemo(() => types.find((t) => t.id === typeId) || null, [types, typeId]);
  const isStorage = !isEdit && !!selected?.is_storage;

  // Only fetched once a storage type is chosen — most log entries never need it.
  useEffect(() => {
    if (!isStorage || places.length > 0) return;
    let alive = true;
    fetch('/api/inventory/count-locations')
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => { if (alive) setPlaces(d.locations || []); })
      .catch(() => { /* the picker says so itself when there is nothing */ });
    return () => { alive = false; };
  }, [isStorage, places.length]);

  const resolvedName = itemChoice === OTHER
    ? otherName.trim()
    : (preppedItems.find((p) => String(p.id) === itemChoice)?.name ?? '');
  const resolvedItemId = itemChoice === OTHER || !itemChoice ? null : Number(itemChoice);

  async function save() {
    if (isEdit) {
      if (!note.trim() && photos.length === 0) { setError('Add a note or a photo.'); return; }
      const res = await run(() => apiSend(`/api/shift-handover/entries/${editEntry!.id}`, 'PATCH', { note, photos }));
      if (res) onSaved();
      return;
    }
    if (!typeId) { setError('Pick a type first.'); return; }
    if (isStorage) {
      if (!resolvedName) { setError(itemChoice === OTHER ? 'Type what it is.' : 'What is it?'); return; }
      const amt = parseAmount(amount);
      if (!Number.isFinite(amt) || amt <= 0) { setError('How much did you prep?'); return; }
      if (!unit) { setError('Pick a unit.'); return; }
      if (whereId == null) { setError('Choose where you put it.'); return; }
    }
    if (!note.trim() && photos.length === 0 && !(isStorage && resolvedName)) { setError('Add a note or a photo.'); return; }
    const res = await run(() => apiSend('/api/shift-handover/entries', 'POST', {
      type_id: typeId, note, photos,
      storage: isStorage ? {
        name: resolvedName, item_id: resolvedItemId, amount: parseAmount(amount), unit,
        prepared_on: preparedOn, location_id: whereId, use_first: useFirst,
      } : null,
      idempotency_key: key,
    }));
    if (res) onSaved();
  }

  const itemOptions = [
    ...preppedItems.map((p) => ({ value: String(p.id), label: p.name })),
    { value: OTHER, label: 'Other…' },
  ];
  const unitOptions = units.map((u) => ({ value: u.name, label: u.name }));

  return (
    <Sheet title={isEdit ? 'Edit note' : 'Add to the log'} onClose={onClose} dismissOnBackdrop={false}
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
          <p className="text-[var(--fs-xs)] text-blue-800">This stays pinned in “In storage now” until someone clears it.</p>
        </div>
      )}

      {isStorage && (
        <>
          <Field label="What is it?">
            <Select value={itemChoice} onChange={setItemChoice} options={itemOptions} placeholder="Choose an item" />
          </Field>
          {itemChoice === OTHER && (
            <Field label="Type what it is">
              <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="e.g. Pumpkin soup" autoFocus
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
            </Field>
          )}

          <Field label="How much?">
            <div className="grid grid-cols-2 gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
              <Select value={unit} onChange={setUnit} options={unitOptions} placeholder="Unit" />
            </div>
          </Field>

          <Field label="Prepared on">
            <input type="date" value={preparedOn} max={berlinTodayLocal()} onChange={(e) => setPreparedOn(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
          </Field>

          <Field label="Where did you put it?">
            <LocationPathButton locations={places} value={whereId} placeholder="Choose a place" onOpen={() => setPickerOpen(true)} />
          </Field>

          <Field label="Use this first?">
            <OptionGrid cols={2} value={useFirst ? 1 : 0} options={[{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]} onChange={(v) => setUseFirst(!!v)} />
          </Field>
        </>
      )}

      <Field label={isStorage ? 'Extra note (optional)' : 'Note'}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={isStorage ? 'Anything else the next shift should know' : 'What did you do? What should the next shift know?'}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 min-h-[160px] text-[var(--fs-base)] outline-none focus:border-green-600" />
      </Field>

      <Field label="Photo (optional)">
        <PhotoCaptureStrip photos={photos} onChange={setPhotos} max={3} />
      </Field>

      {pickerOpen && (
        <LocationPickerSheet
          locations={places}
          value={whereId}
          title="Where did you put it?"
          onPick={(id) => { setWhereId(id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Sheet>
  );
}
