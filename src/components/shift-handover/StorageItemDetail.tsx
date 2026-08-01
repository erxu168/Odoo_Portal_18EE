'use client';

import React, { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Sheet, Field, Select, PrimaryButton, ErrorNote, OptionGrid, apiSend, useAsync, fmtDayShort } from './common';
import { LocationPickerSheet, LocationPathButton, type PickableLocation } from '@/components/ui/LocationPickerSheet';
import type { StorageRow } from './StorageTray';
import type { NamedLookup } from './AddEntrySheet';

const OTHER = '__other__';
function berlinTodayLocal(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

/** Tap a storage item → view its detail, edit it, clear it, or delete it. */
export function StorageItemDetail({ item, preppedItems, units, canEdit, onClose, onClear, onSaved, onDeleted }: {
  item: StorageRow; preppedItems: NamedLookup[]; units: NamedLookup[]; canEdit: boolean;
  onClose: () => void; onClear: (item: StorageRow) => void;
  onSaved: (updated: StorageRow) => void; onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const { busy, error, setError, run } = useAsync();

  // Edit form state. Initialise from the real catalogue LINK (item_id), not by
  // name-matching — a linked item whose catalogue was renamed stays linked, and
  // an "Other" that happens to share a name never gets falsely linked. A link to
  // a since-retired item falls back to "Other" so the picker stays valid.
  const linkedActive = item.item_id != null && preppedItems.some((p) => p.id === item.item_id);
  const [itemChoice, setItemChoice] = useState<string>(linkedActive ? String(item.item_id) : OTHER);
  const [otherName, setOtherName] = useState(linkedActive ? '' : item.name);
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '');
  const [unit, setUnit] = useState(item.unit ?? units[0]?.name ?? '');
  const [preparedOn, setPreparedOn] = useState(item.prepared_on ?? berlinTodayLocal());
  const [whereId, setWhereId] = useState<number | null>(item.location_id ?? null);
  const [useFirst, setUseFirst] = useState(!!item.use_first);
  const [places, setPlaces] = useState<PickableLocation[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!editing || places.length > 0) return;
    let alive = true;
    fetch('/api/inventory/count-locations').then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => { if (alive) setPlaces(d.locations || []); }).catch(() => {});
    return () => { alive = false; };
  }, [editing, places.length]);

  const resolvedName = itemChoice === OTHER ? otherName.trim() : (preppedItems.find((p) => String(p.id) === itemChoice)?.name ?? '');
  const resolvedItemId = itemChoice === OTHER || !itemChoice ? null : Number(itemChoice);

  async function save() {
    if (!resolvedName) { setError('What is it?'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('How much is it?'); return; }
    if (!unit) { setError('Pick a unit.'); return; }
    if (whereId == null) { setError('Choose where it is.'); return; }
    const res = await run(() => apiSend(`/api/shift-handover/storage/${item.id}`, 'PATCH', {
      name: resolvedName, item_id: resolvedItemId, amount: amt, unit, prepared_on: preparedOn, location_id: whereId, use_first: useFirst,
    }));
    if (res?.item) onSaved(res.item as StorageRow);
  }

  async function del() {
    const res = await run(() => apiSend(`/api/shift-handover/storage/${item.id}`, 'DELETE'));
    if (res) onDeleted(item.id);
  }

  const itemOptions = [...preppedItems.map((p) => ({ value: String(p.id), label: p.name })), { value: OTHER, label: 'Other…' }];
  const unitOptions = units.map((u) => ({ value: u.name, label: u.name }));

  return (
    <Sheet title={editing ? 'Edit item' : item.name} onClose={onClose} dismissOnBackdrop={!editing}
      footer={editing
        ? <PrimaryButton onClick={save} busy={busy}>Save changes</PrimaryButton>
        : canEdit ? (
          <div className="flex flex-col gap-2">
            <PrimaryButton onClick={() => onClear(item)}>What happened to it?</PrimaryButton>
            <div className="flex gap-2">
              <button onClick={() => { setError(null); setEditing(true); }} className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-semibold text-[var(--fs-sm)] active:bg-gray-50">Edit</button>
              <button onClick={() => setConfirmDel(true)} className="flex-1 h-11 rounded-xl border border-red-200 text-red-600 font-semibold text-[var(--fs-sm)] active:bg-red-50">Delete</button>
            </div>
          </div>
        ) : null}>
      <ErrorNote>{error}</ErrorNote>

      {!editing ? (
        <div className="flex flex-col">
          {item.photo && <img src={item.photo} alt="" className="w-full max-h-52 object-cover rounded-xl mb-3" />}
          <Row k="Amount" v={item.amount != null && item.unit ? `${item.amount} ${item.unit}` : 'Not recorded'} />
          {item.use_first && <Row k="Use first" v="Yes" />}
          <Row k="Prepared on" v={item.prepared_on ? fmtDayShort(item.prepared_on) : '—'} />
          <Row k="Where" v={item.location_text || '—'} />
          <Row k="Added by" v={item.added_by_name || '—'} last />
        </div>
      ) : (
        <>
          <Field label="What is it?"><Select value={itemChoice} onChange={setItemChoice} options={itemOptions} placeholder="Choose an item" /></Field>
          {itemChoice === OTHER && (
            <Field label="Type what it is"><input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="e.g. Pumpkin soup"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" /></Field>
          )}
          <Field label="How much?">
            <div className="grid grid-cols-2 gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" />
              <Select value={unit} onChange={setUnit} options={unitOptions} placeholder="Unit" />
            </div>
          </Field>
          <Field label="Prepared on"><input type="date" value={preparedOn} max={berlinTodayLocal()} onChange={(e) => setPreparedOn(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" /></Field>
          <Field label="Where is it?"><LocationPathButton locations={places} value={whereId} placeholder="Choose a place" onOpen={() => setPickerOpen(true)} /></Field>
          <Field label="Use this first?"><OptionGrid cols={2} value={useFirst ? 1 : 0} options={[{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }]} onChange={(v) => setUseFirst(!!v)} /></Field>
        </>
      )}

      {pickerOpen && (
        <LocationPickerSheet locations={places} value={whereId} title="Where is it?"
          onPick={(id) => { setWhereId(id); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
      )}
      {confirmDel && (
        <ConfirmDialog title={`Delete ${item.name}?`} message="This removes it from storage. Use “What happened?” instead if it was moved, used, or discarded."
          confirmLabel="Delete" variant="danger" onConfirm={() => { setConfirmDel(false); del(); }} onCancel={() => setConfirmDel(false)} />
      )}
    </Sheet>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-2.5 ${last ? '' : 'border-b border-gray-100'}`}>
      <span className="text-[var(--fs-sm)] text-gray-400 font-medium flex-shrink-0">{k}</span>
      <span className="text-[var(--fs-sm)] text-gray-800 font-semibold text-right break-words">{v}</span>
    </div>
  );
}
