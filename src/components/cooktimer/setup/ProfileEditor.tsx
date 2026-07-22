'use client';
import { useMemo, useRef, useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { OptionGrid } from '@/components/ui/OptionGrid';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import type { CookProfile, CookProfileInput, CookStationAdmin, CookStepType } from '@/types/cooktimer';
import { STEP_TYPE_OPTIONS, totalCookSeconds, fmtDuration } from './utils';
import ProductPickerSheet from './ProductPickerSheet';

interface EditStep { key: string; label: string; stepType: CookStepType; durationSeconds: number; }

/** Full-screen create/edit sheet for one cook profile. */
export default function ProfileEditor({
  profile, stations, onClose, onSave,
}: {
  profile: CookProfile | null;
  stations: CookStationAdmin[];
  onClose: () => void;
  onSave: (input: CookProfileInput, id: number | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  const keyRef = useRef(0);
  const newKey = () => `n${keyRef.current++}`;

  const [productId, setProductId] = useState<number | null>(profile?.odooProductId ?? null);
  const [name, setName] = useState(profile?.name ?? '');
  const [stationId, setStationId] = useState<number | null>(
    profile?.stationId ?? (stations.find(s => s.active) ?? stations[0])?.id ?? null,
  );
  const [active, setActive] = useState(profile?.active ?? false);
  const [steps, setSteps] = useState<EditStep[]>(() =>
    profile?.steps.length
      ? profile.steps.map(s => ({ key: `db${s.id}`, label: s.label, stepType: s.stepType, durationSeconds: s.durationSeconds }))
      : [{ key: newKey(), label: 'Cook', stepType: 'cook', durationSeconds: 60 }],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );

  const total = useMemo(() => totalCookSeconds(steps), [steps]);
  const canSave = name.trim() !== '' && stationId != null && steps.length > 0 && !saving;

  function patchStep(key: string, patch: Partial<EditStep>) {
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps(prev => [...prev, { key: newKey(), label: 'Cook', stepType: 'cook', durationSeconds: 60 }]);
  }
  function removeStep(key: string) {
    setSteps(prev => (prev.length > 1 ? prev.filter(s => s.key !== key) : prev));
  }
  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    setSteps(prev => {
      const from = prev.findIndex(s => s.key === a.id);
      const to = prev.findIndex(s => s.key === over.id);
      return from === -1 || to === -1 ? prev : arrayMove(prev, from, to);
    });
  }

  async function handleSave() {
    if (!canSave || stationId == null) return;
    setError(null);
    if (active && productId == null) { setError('Pick a product before turning this profile on.'); return; }
    setSaving(true);
    const input: CookProfileInput = {
      odooProductId: productId,
      name: name.trim(),
      stationId,
      maxBatch: profile?.maxBatch ?? null, // batch-limit UI is phase 2; preserve any stored value
      active,
      steps: steps.map(s => ({
        label: s.label.trim(),
        stepType: s.stepType,
        durationSeconds: s.stepType === 'action' ? 0 : s.durationSeconds,
      })),
    };
    const res = await onSave(input, profile?.id ?? null);
    setSaving(false);
    if (res.ok) onClose();
    else setError(res.error ?? 'Could not save.');
  }

  return (
    <div className="fixed inset-0 z-[90] bg-[#F6F7F9] flex flex-col">
      {/* header */}
      <div className="flex items-center gap-3 px-4 h-14 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onClose} className="text-[15px] font-semibold text-gray-500 active:text-gray-800">Cancel</button>
        <div className="flex-1 text-center font-bold text-gray-900">{profile ? 'Edit profile' : 'New profile'}</div>
        <div className="w-[52px]" />
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2.5">{error}</div>
        )}

        {/* product */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-2">Product</div>
          {productId == null ? (
            <button onClick={() => setPickerOpen(true)} className="w-full rounded-xl border border-dashed border-gray-300 text-gray-500 py-3 font-semibold active:bg-gray-50">
              Pick a product from the catalog
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 truncate">{name || 'Selected product'}</div>
                <div className="text-xs text-gray-400">Odoo product #{productId}</div>
              </div>
              <button onClick={() => setPickerOpen(true)} className="text-sm font-semibold text-sky-600 active:text-sky-800">Change</button>
            </div>
          )}
        </div>

        {/* name + station + batch */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          <div>
            <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Display name</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Shown on the timer card"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Station</div>
            <select value={stationId ?? ''} onChange={e => setStationId(Number(e.target.value))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] bg-white focus:outline-none focus:border-sky-400">
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (off)'}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center justify-between pt-1">
            <span className="text-[15px] font-semibold text-gray-800">Active <span className="font-medium text-gray-400">— appears in the TO COOK queue</span></span>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-6 h-6 accent-green-500" />
          </label>
        </div>

        {/* steps */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase">Cook steps</div>
            <div className="text-sm font-bold text-gray-700 tabular-nums">Total {fmtDuration(total)}</div>
          </div>
          <p className="text-xs text-gray-400 mb-3 leading-relaxed">
            Drag the <span className="font-bold">grip</span> to reorder. <b>Cook</b>/<b>Rest</b> count down and alarm; <b>Action</b> is an instant prompt (e.g. Spray beer) with no timer.
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map(s => s.key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2.5">
                {steps.map((s, i) => (
                  <SortableStepRow key={s.key} step={s} index={i} canRemove={steps.length > 1}
                    onChange={patch => patchStep(s.key, patch)} onRemove={() => removeStep(s.key)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <button onClick={addStep} className="mt-3 w-full rounded-xl border border-dashed border-green-400 text-green-700 py-2.5 font-bold active:bg-green-50">
            ＋ Add step
          </button>
        </div>
        <div className="h-2" />
      </div>

      {/* sticky footer */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <PrimaryButton busy={saving} disabled={!canSave} onClick={handleSave}>
          {profile ? 'Save changes' : 'Create profile'}
        </PrimaryButton>
      </div>

      {pickerOpen && (
        <ProductPickerSheet
          onClose={() => setPickerOpen(false)}
          onPick={p => { setProductId(p.id); if (!name.trim()) setName(p.name); setPickerOpen(false); }}
        />
      )}
    </div>
  );
}

function SortableStepRow({
  step, index, canRemove, onChange, onRemove,
}: {
  step: EditStep;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<EditStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  } as React.CSSProperties;

  const min = Math.floor(step.durationSeconds / 60);
  const sec = step.durationSeconds % 60;
  const setMin = (m: number) => onChange({ durationSeconds: Math.max(0, m) * 60 + sec });
  const setSec = (s: number) => onChange({ durationSeconds: min * 60 + Math.min(59, Math.max(0, s)) });

  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder step"
          className="px-1.5 py-2 text-gray-400 cursor-grab active:cursor-grabbing touch-none select-none"
          style={{ touchAction: 'none' }}
        >
          <GripIcon />
        </button>
        <span className="w-5 h-5 rounded bg-white border border-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center flex-shrink-0">{index + 1}</span>
        <input
          value={step.label}
          onChange={e => onChange({ label: e.target.value })}
          placeholder="Step name"
          className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2.5 py-2 text-[15px] bg-white focus:outline-none focus:border-sky-400"
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove step"
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${canRemove ? 'text-red-500 active:bg-red-50' : 'text-gray-300 cursor-default'}`}
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 mt-2 pl-8">
        <div className="flex-1">
          <OptionGrid<CookStepType>
            value={step.stepType}
            options={STEP_TYPE_OPTIONS}
            cols={3}
            ariaLabel="Step type"
            onChange={v => onChange({ stepType: v, durationSeconds: v === 'action' ? 0 : (step.durationSeconds || 60) })}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {step.stepType === 'action' ? (
            <span className="text-xs font-bold text-sky-600 tracking-wide px-1">INSTANT</span>
          ) : (
            <>
              <input
                inputMode="numeric" aria-label="Minutes"
                value={min} onChange={e => setMin(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                className="w-12 rounded-lg border border-gray-300 px-2 py-2 text-[15px] text-center tabular-nums bg-white focus:outline-none focus:border-sky-400"
              />
              <span className="text-gray-400 text-sm font-bold">:</span>
              <input
                inputMode="numeric" aria-label="Seconds"
                value={String(sec).padStart(2, '0')} onChange={e => setSec(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                className="w-12 rounded-lg border border-gray-300 px-2 py-2 text-[15px] text-center tabular-nums bg-white focus:outline-none focus:border-sky-400"
              />
              <span className="text-[10px] text-gray-400 font-semibold">m:ss</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
      {[3, 9, 15].map(y => (
        <g key={y}>
          <circle cx="4" cy={y} r="1.6" /><circle cx="10" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}
