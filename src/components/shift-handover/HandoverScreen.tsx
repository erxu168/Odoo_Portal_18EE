'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import PhotoCaptureStrip from '@/components/inventory/PhotoCaptureStrip';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { ContainerCard, type ContainerView } from './ContainerCard';
import { Chip, OptionGrid, Select, Field, PrimaryButton, ErrorNote, Sheet, apiGet, apiSend, useAsync } from './common';
import { HANDOVER_STATUS_LABELS, HANDOVER_STATUS_BADGE, DISCREPANCY_LABELS, PRIORITY_LABELS, PRIORITY_BADGE } from '@/lib/shift-handover/labels';
import { DISCREPANCY_TYPES } from '@/lib/shift-handover/states';

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'ready_for_service', label: 'Ready for Service' },
  { key: 'backup_stock', label: 'Backup Stock' },
  { key: 'in_production_or_cooling', label: 'In Production or Cooling' },
  { key: 'components_prepared', label: 'Components Prepared Separately' },
  { key: 'use_first', label: 'Use First' },
  { key: 'on_hold_or_discrepancy', label: 'On Hold' },
];

function Section({ label, containers }: { label: string; containers: ContainerView[] }) {
  if (!containers?.length) return null;
  return (
    <div className="mb-4">
      <h3 className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-500 mb-2">{label} · {containers.length}</h3>
      <div className="flex flex-col gap-2">{containers.map((c) => <ContainerCard key={c.id} c={c} />)}</div>
    </div>
  );
}

export function HandoverScreen({ operationalDate, shiftLabels, canSubmit, canAcknowledge, initialDetailId = null, onBack }: {
  operationalDate: string; shiftLabels: string[]; canSubmit: boolean; canAcknowledge: boolean; initialDetailId?: number | null; onBack: () => void;
}) {
  const [detailId, setDetailId] = useState<number | null>(initialDetailId);
  if (detailId != null) {
    return <HandoverDetail id={detailId} canAcknowledge={canAcknowledge} onBack={() => setDetailId(null)} />;
  }
  return <HandoverMain operationalDate={operationalDate} shiftLabels={shiftLabels} canSubmit={canSubmit} onBack={onBack} onOpen={setDetailId} />;
}

// ── Main: live preview + submit + history list ───────────────────────────────
function HandoverMain({ operationalDate, shiftLabels, canSubmit, onBack, onOpen }: {
  operationalDate: string; shiftLabels: string[]; canSubmit: boolean; onBack: () => void; onOpen: (id: number) => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [list, setList] = useState<any[] | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  const load = useCallback(() => {
    apiGet(`/api/shift-handover/handovers/preview?date=${operationalDate}`).then(setPreview).catch(() => setPreview({ sections: {} }));
    apiGet(`/api/shift-handover/handovers?limit=20`).then((d: any) => setList(d.handovers || [])).catch(() => setList([]));
  }, [operationalDate]);
  useEffect(load, [load]);

  const s = preview?.sections || {};
  const noProd = s.no_production;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <AppHeader supertitle="SHIFT HANDOVER" title="Handover" subtitle={operationalDate} showBack onBack={onBack} />

      <div className="flex-1 px-4 py-4">
        {!preview ? <Spinner /> : (
          <>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
              <h2 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-0.5">This shift’s handover</h2>
              <p className="text-[var(--fs-sm)] text-gray-500 mb-3">Auto-generated from what’s in storage right now.</p>
              {noProd ? (
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-4 text-center text-[var(--fs-sm)] text-gray-500">No production recorded this shift.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Stat n={s.ready_for_service?.length || 0} label="Ready" />
                  <Stat n={s.backup_stock?.length || 0} label="Backup" />
                  <Stat n={s.in_production_or_cooling?.length || 0} label="Cooling / prep" />
                  <Stat n={s.use_first?.length || 0} label="Use first" />
                </div>
              )}
              {canSubmit && !noProd && (
                <button onClick={() => setShowSubmit(true)} className="mt-3 w-full bg-green-600 text-white font-semibold rounded-xl py-3 text-[var(--fs-sm)] active:bg-green-700">Submit this handover</button>
              )}
            </div>

            {SECTIONS.map((sec) => <Section key={sec.key} label={sec.label} containers={s[sec.key] || []} />)}
            {(s.actions_required?.length || 0) > 0 && (
              <div className="mb-4">
                <h3 className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-500 mb-2">Actions Required · {s.actions_required.length}</h3>
                <div className="flex flex-col gap-2">
                  {s.actions_required.map((a: any) => (
                    <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2">
                      <Chip tone={PRIORITY_BADGE[a.priority] || 'draft'}>{PRIORITY_LABELS[a.priority] || a.priority}</Chip>
                      <span className="text-[var(--fs-sm)] text-gray-800 flex-1">{a.instruction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h3 className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2 mt-6">Recent handovers</h3>
            {list === null ? <Spinner /> : list.length === 0 ? (
              <p className="text-[var(--fs-sm)] text-gray-400 px-1">No handovers submitted yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {list.map((h) => (
                  <button key={h.id} onClick={() => onOpen(h.id)} className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 active:bg-gray-50 flex items-center justify-between">
                    <div>
                      <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{h.operational_date}{h.outgoing_shift_label ? ` · ${h.outgoing_shift_label}` : ''}</div>
                      <div className="text-[var(--fs-xs)] text-gray-400">{h.submitted_by_name ? `by ${h.submitted_by_name}` : 'draft'}</div>
                    </div>
                    <Chip tone={HANDOVER_STATUS_BADGE[h.status] || 'draft'}>{HANDOVER_STATUS_LABELS[h.status] || h.status}</Chip>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showSubmit && (
        <SubmitSheet operationalDate={operationalDate} shiftLabels={shiftLabels} onClose={() => setShowSubmit(false)} onSubmitted={(id) => { setShowSubmit(false); load(); onOpen(id); }} />
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 py-2.5 text-center">
      <div className="text-[var(--fs-xl)] font-bold text-gray-900">{n}</div>
      <div className="text-[var(--fs-xs)] text-gray-500">{label}</div>
    </div>
  );
}

// ── Submit sheet ─────────────────────────────────────────────────────────────
function SubmitSheet({ operationalDate, shiftLabels, onClose, onSubmitted }: {
  operationalDate: string; shiftLabels: string[]; onClose: () => void; onSubmitted: (id: number) => void;
}) {
  const [outgoing, setOutgoing] = useState('');
  const [incoming, setIncoming] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(() => `submit-${operationalDate}-${Math.round(Math.random() * 1e9)}`);
  const { busy, error, run } = useAsync();

  async function submit() {
    const res = await run(() => apiSend('/api/shift-handover/handovers/submit', 'POST', {
      operational_date: operationalDate, outgoing_shift_label: outgoing || null, incoming_shift_label: incoming || null,
      summary_note: note || null, idempotency_key: key,
    }));
    if (res?.handover_id) onSubmitted(res.handover_id);
  }

  return (
    <Sheet title="Submit handover" onClose={onClose} footer={<PrimaryButton onClick={submit} busy={busy}>Submit &amp; lock</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">Once submitted, this handover is locked. The next shift leader reviews and acknowledges it.</p>
      {shiftLabels.length > 0 && (
        <>
          <Field label="Outgoing shift"><OptionGrid cols={3} value={outgoing} options={shiftLabels.map((l) => ({ value: l, label: l }))} onChange={setOutgoing} /></Field>
          <Field label="Incoming shift"><OptionGrid cols={3} value={incoming} options={shiftLabels.map((l) => ({ value: l, label: l }))} onChange={setIncoming} /></Field>
        </>
      )}
      <Field label="Handover note (optional)">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next shift should know" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 min-h-[72px] outline-none focus:border-green-600" />
      </Field>
    </Sheet>
  );
}

// ── Detail + acknowledge ─────────────────────────────────────────────────────
function HandoverDetail({ id, canAcknowledge, onBack }: { id: number; canAcknowledge: boolean; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [showAck, setShowAck] = useState(false);
  const load = useCallback(() => { apiGet(`/api/shift-handover/handovers/${id}`).then(setData).catch(() => setData(null)); }, [id]);
  useEffect(load, [load]);

  if (!data) return <div className="min-h-screen bg-gray-50"><AppHeader title="Handover" showBack onBack={onBack} /><Spinner /></div>;
  const h = data.handover;
  const containers: ContainerView[] = (data.snapshot_containers || []).map((r: any) => ({
    id: r.id, product_id: 0, product_name: r.product_name, container_code: r.container_code, container_type_name: r.container_type_name,
    fill_level: r.fill_level, preparation_state: r.preparation_state, availability_state: r.availability_state,
    storage_location_id: r.storage_location_id, storage_location_name: r.storage_location_name, use_first: r.use_first, next_action: r.next_action, status: 'active',
  }));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      <AppHeader supertitle="HANDOVER" title={`${h.operational_date}${h.outgoing_shift_label ? ' · ' + h.outgoing_shift_label : ''}`} subtitle={HANDOVER_STATUS_LABELS[h.status]} showBack onBack={onBack} />
      <div className="flex-1 px-4 py-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <Chip tone={HANDOVER_STATUS_BADGE[h.status] || 'draft'}>{HANDOVER_STATUS_LABELS[h.status]}</Chip>
            {h.snapshot_hash && <span className="text-[10px] text-gray-300 font-mono">#{String(h.snapshot_hash).slice(0, 8)}</span>}
          </div>
          <p className="text-[var(--fs-sm)] text-gray-600">
            {h.submitted_by_name ? `Submitted by ${h.submitted_by_name}` : 'Draft'}
            {h.submitted_at ? ` at ${new Date(h.submitted_at).toLocaleString()}` : ''}
          </p>
          {h.acknowledged_by_name && <p className="text-[var(--fs-sm)] text-gray-600 mt-1">Acknowledged by {h.acknowledged_by_name} · {h.acknowledged_at ? new Date(h.acknowledged_at).toLocaleString() : ''}</p>}
          {h.summary_note && <p className="text-[var(--fs-sm)] text-gray-800 mt-2 bg-gray-50 rounded-lg px-3 py-2">{h.summary_note}</p>}
        </div>

        {(data.discrepancies || []).length > 0 && (
          <div className="mb-4">
            <h3 className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-red-500 mb-2">Discrepancies · {data.discrepancies.length}</h3>
            <div className="flex flex-col gap-2">
              {data.discrepancies.map((d: any) => (
                <div key={d.id} className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1"><Chip tone="overdue">{DISCREPANCY_LABELS[d.discrepancy_type] || d.discrepancy_type}</Chip><span className="text-[var(--fs-xs)] text-gray-500">{d.reported_by_name}</span></div>
                  {d.note && <p className="text-[var(--fs-sm)] text-gray-700">{d.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <h3 className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-500 mb-2">Frozen snapshot · {containers.length} container{containers.length !== 1 ? 's' : ''}</h3>
        <div className="flex flex-col gap-2">{containers.map((c) => <ContainerCard key={c.id} c={c} />)}</div>
      </div>

      {canAcknowledge && h.status === 'submitted' && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <PrimaryButton onClick={() => setShowAck(true)}>Review &amp; acknowledge</PrimaryButton>
        </div>
      )}

      {showAck && (
        <AcknowledgeSheet handoverId={id} snapshotContainers={data.snapshot_containers || []} onClose={() => setShowAck(false)} onDone={() => { setShowAck(false); load(); }} />
      )}
    </div>
  );
}

// ── Acknowledge sheet (with discrepancies) ───────────────────────────────────
interface DiscDraft { discrepancy_type: string; snapshot_container_id: number | null; note: string; photos: string[] }

function AcknowledgeSheet({ handoverId, snapshotContainers, onClose, onDone }: {
  handoverId: number; snapshotContainers: any[]; onClose: () => void; onDone: () => void;
}) {
  const [discs, setDiscs] = useState<DiscDraft[]>([]);
  const [key] = useState(() => `ack-${handoverId}-${Math.round(Math.random() * 1e9)}`);
  const { busy, error, run } = useAsync();
  const contOptions = snapshotContainers.map((c) => ({ value: c.id, label: `${c.container_code} · ${c.product_name}` }));

  function addDisc() { setDiscs((d) => [...d, { discrepancy_type: 'quantity_differs', snapshot_container_id: contOptions[0]?.value ?? null, note: '', photos: [] }]); }
  const upd = (i: number, patch: Partial<DiscDraft>) => setDiscs((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function confirm(withDisc: boolean) {
    const res = await run(() => apiSend(`/api/shift-handover/handovers/${handoverId}/acknowledge`, 'POST', {
      outcome: withDisc ? 'discrepancy' : 'confirmed', idempotency_key: key,
      discrepancies: withDisc ? discs.map((d) => ({ discrepancy_type: d.discrepancy_type, snapshot_container_id: d.snapshot_container_id, note: d.note || null, photo: d.photos[0] || null })) : [],
    }));
    if (res) onDone();
  }

  return (
    <Sheet title="Acknowledge handover" onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {discs.length > 0
            ? <PrimaryButton onClick={() => confirm(true)} busy={busy}>Acknowledge with {discs.length} issue{discs.length > 1 ? 's' : ''}</PrimaryButton>
            : <PrimaryButton onClick={() => confirm(false)} busy={busy}>Everything matches — confirm</PrimaryButton>}
        </div>
      }>
      <ErrorNote>{error}</ErrorNote>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">Check the handover against what you actually see. If something differs, report it — the frozen snapshot stays untouched.</p>

      {discs.map((d, i) => (
        <div key={i} className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--fs-sm)] font-semibold text-red-700">Issue {i + 1}</span>
            <button onClick={() => setDiscs((x) => x.filter((_, j) => j !== i))} className="text-red-400 text-[var(--fs-xs)]">Remove</button>
          </div>
          <Field label="What’s wrong?">
            <OptionGrid cols={2} value={d.discrepancy_type} options={DISCREPANCY_TYPES.filter((t) => t !== 'confirmed').map((t) => ({ value: t, label: DISCREPANCY_LABELS[t] }))} onChange={(v) => upd(i, { discrepancy_type: v })} />
          </Field>
          {contOptions.length > 0 && (
            <Field label="Which container?">
              <Select value={d.snapshot_container_id} onChange={(v) => upd(i, { snapshot_container_id: v ? parseInt(v, 10) : null })} options={contOptions} placeholder="(not container-specific)" />
            </Field>
          )}
          <Field label="Note (optional)">
            <input value={d.note} onChange={(e) => upd(i, { note: e.target.value })} className="w-full bg-white border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" placeholder="Describe the issue" />
          </Field>
          <Field label="Photo (optional)"><PhotoCaptureStrip photos={d.photos} onChange={(ph) => upd(i, { photos: ph })} max={1} /></Field>
        </div>
      ))}

      <button onClick={addDisc} className="w-full h-11 rounded-xl border border-red-200 text-red-600 font-semibold text-[var(--fs-sm)] active:bg-red-50">+ Report a discrepancy</button>
    </Sheet>
  );
}
