'use client';

import React, { useState } from 'react';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import AppHeader from '@/components/ui/AppHeader';
import { OptionGrid, Select, Field, PrimaryButton, ErrorNote, buildLocationOptions, apiSend, useAsync, Chip, type FlatLocation } from './common';
import { PREP_LABELS, AVAIL_LABELS, FILL_LABELS, KIND_LABELS } from '@/lib/shift-handover/labels';
import { PREPARATION_STATES, AVAILABILITY_STATES, FILL_LEVELS, isServeablePrep } from '@/lib/shift-handover/states';

interface Product { id: number; name: string; kind: string; photo_policy: string }
interface Cfg { products: Product[]; container_types: Array<{ id: number; name: string }>; locations: FlatLocation[]; shift_labels: string[]; }

interface Draft {
  key: number; container_type_id: number | null; fill_level: number; storage_location_id: number | null;
  preparation_state: string; availability_state: string; use_first: boolean; next_action: string; photos: string[];
}

function blankDraft(prep: string, key: number): Draft {
  return { key, container_type_id: null, fill_level: 100, storage_location_id: null, preparation_state: prep, availability_state: 'not_ready', use_first: false, next_action: '', photos: [] };
}

export function RecordProduction({ cfg, operationalDate, onDone, onBack }: {
  cfg: Cfg; operationalDate: string; onDone: () => void; onBack: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [shiftLabel, setShiftLabel] = useState<string>('');
  const [defaultPrep, setDefaultPrep] = useState<string>('chilled');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { busy, error, setError, run } = useAsync();
  const locOptions = buildLocationOptions(cfg.locations);

  function addDrafts(n: number) {
    // Keys derived from current drafts (not a module counter), and setExpanded is
    // called OUTSIDE the state updater — both avoid a StrictMode double-invoke
    // leaving `expanded` pointing at a key that never got committed.
    const start = (drafts.length ? Math.max(...drafts.map((x) => x.key)) : 0) + 1;
    const added = Array.from({ length: n }, (_, i) => blankDraft(defaultPrep, start + i));
    setDrafts((d) => [...d, ...added]);
    setExpanded(start);
  }
  const upd = (key: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => setDrafts((d) => d.filter((x) => x.key !== key));

  async function save() {
    if (!product) { setError('Choose a product first.'); return; }
    if (drafts.length === 0) { setError('Add at least one container.'); return; }
    const res = await run(() => apiSend('/api/shift-handover/batches', 'POST', {
      operational_date: operationalDate, product_id: product.id, shift_label: shiftLabel || null,
      containers: drafts.map((d) => ({
        container_type_id: d.container_type_id, fill_level: d.fill_level, storage_location_id: d.storage_location_id,
        preparation_state: d.preparation_state, availability_state: d.availability_state, use_first: d.use_first,
        next_action: d.next_action || null, quantity_method: 'container_estimate', photos: d.photos,
      })),
    }).catch((e: any) => {
      if (e.validation) setError(`${e.message} (${e.validation.length} container${e.validation.length > 1 ? 's' : ''} need a location, state or photo)`);
      else setError(e.message);
      throw e;
    }));
    if (res) onDone();
  }

  const photoNote = product?.photo_policy === 'mandatory';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-28">
      <AppHeader supertitle="SHIFT HANDOVER" title="Record production" subtitle={operationalDate} showBack onBack={onBack} />

      <div className="px-4 py-4 flex-1">
        <ErrorNote>{error}</ErrorNote>

        {/* Step 1 — product */}
        <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">1 · What did you make?</p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {cfg.products.map((p) => (
            <button key={p.id} onClick={() => setProduct(p)}
              className={`text-left p-3 rounded-2xl border min-h-[64px] active:scale-[0.98] transition-transform ${product?.id === p.id ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
              <div className="text-[var(--fs-base)] font-bold leading-tight">{p.name}</div>
              <div className={`text-[var(--fs-xs)] mt-0.5 ${product?.id === p.id ? 'text-white/70' : 'text-gray-400'}`}>{KIND_LABELS[p.kind] || p.kind}</div>
            </button>
          ))}
        </div>

        {product && (
          <>
            {/* Step 2 — shift + default state */}
            <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">2 · Shift &amp; default state</p>
            {cfg.shift_labels.length > 0 && (
              <Field label="Outgoing shift">
                <OptionGrid cols={3} value={shiftLabel} options={cfg.shift_labels.map((s) => ({ value: s, label: s }))} onChange={setShiftLabel} />
              </Field>
            )}
            <Field label="Default state for new containers">
              <OptionGrid cols={3} value={defaultPrep} options={PREPARATION_STATES.map((s) => ({ value: s, label: PREP_LABELS[s] }))} onChange={setDefaultPrep} />
            </Field>

            {/* Step 3 — containers */}
            <div className="flex items-center justify-between mb-2 mt-4">
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400">3 · Containers ({drafts.length})</p>
              {photoNote && <Chip tone="overdue">Photo required</Chip>}
            </div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => addDrafts(1)} className="flex-1 h-11 rounded-xl border border-green-600 text-green-700 font-semibold text-[var(--fs-sm)] active:bg-green-50">+ Add container</button>
              <button onClick={() => addDrafts(3)} className="flex-1 h-11 rounded-xl border border-green-600 text-green-700 font-semibold text-[var(--fs-sm)] active:bg-green-50">+ Add 3 identical</button>
            </div>

            <div className="flex flex-col gap-2">
              {drafts.map((d, i) => (
                <div key={d.key} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="w-full flex items-center gap-2 p-3">
                    <button onClick={() => setExpanded(expanded === d.key ? null : d.key)} className="flex-1 flex items-center gap-2 text-left active:opacity-70 min-w-0">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gray-900 text-white text-[var(--fs-xs)] font-bold flex-shrink-0">{String.fromCharCode(65 + i)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--fs-sm)] font-semibold text-gray-900">{cfg.container_types.find((t) => t.id === d.container_type_id)?.name || 'Choose container'} · {FILL_LABELS[d.fill_level]}</span>
                        <span className="block text-[var(--fs-xs)] text-gray-400 truncate">{locOptions.find((l) => l.value === d.storage_location_id)?.label || 'No location'} · {PREP_LABELS[d.preparation_state]}</span>
                      </span>
                    </button>
                    {d.use_first && <Chip tone="due_soon">Use first</Chip>}
                    <button onClick={() => remove(d.key)} className="text-gray-300 active:text-red-500 w-8 h-8 flex items-center justify-center flex-shrink-0" aria-label="Remove container">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>

                  {expanded === d.key && (
                    <div className="px-3 pb-3 border-t border-gray-100 pt-3">
                      <Field label="Container type">
                        <Select value={d.container_type_id} onChange={(v) => upd(d.key, { container_type_id: v ? parseInt(v, 10) : null })} options={cfg.container_types.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose a container" />
                      </Field>
                      <Field label="How full?">
                        <OptionGrid cols={5} value={d.fill_level} options={FILL_LEVELS.map((f) => ({ value: f, label: FILL_LABELS[f] }))} onChange={(v) => upd(d.key, { fill_level: v })} />
                      </Field>
                      <Field label="Storage location">
                        <Select value={d.storage_location_id} onChange={(v) => upd(d.key, { storage_location_id: v ? parseInt(v, 10) : null })} options={locOptions} placeholder="Choose where it is stored" />
                      </Field>
                      <Field label="Preparation state">
                        <OptionGrid cols={3} value={d.preparation_state} options={PREPARATION_STATES.map((s) => ({ value: s, label: PREP_LABELS[s] }))}
                          onChange={(v) => upd(d.key, { preparation_state: v, availability_state: !isServeablePrep(v) && d.availability_state === 'ready_for_service' ? 'not_ready' : d.availability_state })} />
                      </Field>
                      <Field label="Availability">
                        <OptionGrid cols={2} value={d.availability_state}
                          options={AVAILABILITY_STATES.filter((s) => !['depleted', 'discarded', 'expired'].includes(s)).map((s) => ({ value: s, label: AVAIL_LABELS[s], disabled: s === 'ready_for_service' && !isServeablePrep(d.preparation_state) }))}
                          onChange={(v) => upd(d.key, { availability_state: v })} />
                      </Field>
                      <Field label="Use this container first?">
                        <OptionGrid cols={2} value={d.use_first ? 1 : 0} options={[{ value: 1, label: 'Yes — use first' }, { value: 0, label: 'No' }]} onChange={(v) => upd(d.key, { use_first: !!v })} />
                      </Field>
                      <Field label="What must happen next? (optional)">
                        <input value={d.next_action} onChange={(e) => upd(d.key, { next_action: e.target.value })} placeholder="e.g. Use after container A"
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] outline-none focus:border-green-600" />
                      </Field>
                      <Field label={`Photos${photoNote ? ' (required)' : ''}`}>
                        <PhotoCaptureStrip photos={d.photos} onChange={(ph) => upd(d.key, { photos: ph })} max={3} />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {product && drafts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <PrimaryButton onClick={save} busy={busy}>Save batch · {drafts.length} container{drafts.length > 1 ? 's' : ''}</PrimaryButton>
        </div>
      )}
    </div>
  );
}
