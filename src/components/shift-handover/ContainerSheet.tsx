'use client';

import React, { useEffect, useState } from 'react';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import { Sheet, Field, OptionGrid, Select, PrimaryButton, ErrorNote, buildLocationOptions, apiGet, apiSend, useAsync, type FlatLocation } from './common';
import { PREP_LABELS, AVAIL_LABELS, FILL_LABELS, QMETHOD_LABELS } from '@/lib/shift-handover/labels';
import { PREPARATION_STATES, AVAILABILITY_STATES, FILL_LEVELS, QUANTITY_METHODS, isServeablePrep } from '@/lib/shift-handover/states';

interface Cfg { container_types: Array<{ id: number; name: string }>; locations: FlatLocation[]; }

export function ContainerSheet({ containerId, cfg, canEdit, onClose, onSaved }: {
  containerId: number; cfg: Cfg; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [c, setC] = useState<any>(null);
  const [photos, setPhotos] = useState<any[]>([]);
  const [newPhotos, setNewPhotos] = useState<string[]>([]);
  const { busy, error, setError, run } = useAsync();

  useEffect(() => {
    apiGet(`/api/shift-handover/containers/${containerId}`).then((d: any) => { setC(d.container); setPhotos(d.photos || []); }).catch((e) => setError(e.message));
  }, [containerId, setError]);

  if (!c) {
    return <Sheet title="Container" onClose={onClose}><div className="py-10 text-center text-gray-400">Loading…</div></Sheet>;
  }

  const set = (patch: any) => setC({ ...c, ...patch });
  const availOptions = AVAILABILITY_STATES.map((s) => ({
    value: s, label: AVAIL_LABELS[s],
    disabled: s === 'ready_for_service' && !isServeablePrep(c.preparation_state),
  }));

  async function save() {
    await run(async () => {
      await apiSend(`/api/shift-handover/containers/${containerId}`, 'PATCH', {
        container_type_id: c.container_type_id, fill_level: c.fill_level, quantity_method: c.quantity_method,
        preparation_state: c.preparation_state, availability_state: c.availability_state,
        storage_location_id: c.storage_location_id, use_first: !!c.use_first, next_action: c.next_action || null,
        status: c.status,
      });
      for (const p of newPhotos) {
        await apiSend(`/api/shift-handover/containers/${containerId}/photo`, 'POST', { photo: p, event: 'production' });
      }
      onSaved();
    });
  }

  const footer = canEdit ? <PrimaryButton onClick={save} busy={busy}>Save container {c.container_code}</PrimaryButton> : null;

  return (
    <Sheet title={`Container ${c.container_code}`} onClose={onClose} footer={footer}>
      <ErrorNote>{error}</ErrorNote>

      <Field label="Container type">
        <Select value={c.container_type_id} onChange={(v) => set({ container_type_id: v ? parseInt(v, 10) : null })}
          options={cfg.container_types.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose a container" />
      </Field>

      <Field label="How full?">
        <OptionGrid cols={5} value={c.fill_level}
          options={FILL_LEVELS.map((f) => ({ value: f, label: FILL_LABELS[f] }))}
          onChange={(v) => set({ fill_level: v })} />
      </Field>

      <Field label="Storage location">
        <Select value={c.storage_location_id} onChange={(v) => set({ storage_location_id: v ? parseInt(v, 10) : null })}
          options={buildLocationOptions(cfg.locations)} placeholder="Choose where it is stored" />
      </Field>

      <Field label="Preparation state (what happened to it)">
        <OptionGrid cols={3} value={c.preparation_state}
          options={PREPARATION_STATES.map((s) => ({ value: s, label: PREP_LABELS[s] }))}
          onChange={(v) => {
            // Keep availability consistent when moving to a not-yet-serveable state.
            const next: any = { preparation_state: v };
            if (!isServeablePrep(v) && c.availability_state === 'ready_for_service') next.availability_state = 'not_ready';
            set(next);
          }} />
      </Field>

      <Field label="Can it be used? (availability)">
        <OptionGrid cols={2} value={c.availability_state} options={availOptions} onChange={(v) => set({ availability_state: v })} />
      </Field>

      <Field label="How was the amount judged?">
        <OptionGrid cols={3} value={c.quantity_method}
          options={QUANTITY_METHODS.map((m) => ({ value: m, label: QMETHOD_LABELS[m] }))}
          onChange={(v) => set({ quantity_method: v })} />
      </Field>

      <Field label="Use this container first?">
        <OptionGrid cols={2} value={c.use_first ? 1 : 0}
          options={[{ value: 1, label: 'Yes — use first' }, { value: 0, label: 'No' }]}
          onChange={(v) => set({ use_first: v })} />
      </Field>

      <Field label="What must happen next? (optional)">
        <textarea value={c.next_action || ''} onChange={(e) => set({ next_action: e.target.value })}
          placeholder="e.g. Move to countertop fridge before 17:00"
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-base)] outline-none focus:border-green-600 min-h-[64px]" />
      </Field>

      <Field label="Photos">
        {photos.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.photo} alt={p.caption || ''} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
            ))}
          </div>
        )}
        {canEdit && <PhotoCaptureStrip photos={newPhotos} onChange={setNewPhotos} max={3} />}
      </Field>

      {canEdit && (
        <Field label="Container lifecycle">
          <OptionGrid cols={3} value={c.status}
            options={[{ value: 'active', label: 'Active' }, { value: 'depleted', label: 'Used up' }, { value: 'discarded', label: 'Discarded' }]}
            onChange={(v) => {
              const next: any = { status: v };
              if (v === 'depleted') next.availability_state = 'depleted';
              if (v === 'discarded') next.availability_state = 'discarded';
              set(next);
            }} />
        </Field>
      )}
    </Sheet>
  );
}
