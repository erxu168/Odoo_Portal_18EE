'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, FilterBar, FilterPill } from '@/components/inventory/ui';
import { Chip, OptionGrid, Field, Select, PrimaryButton, ErrorNote, Sheet, buildLocationOptions, apiGet, apiSend, useAsync, type FlatLocation } from './common';
import { KIND_LABELS } from '@/lib/shift-handover/labels';
import { PHOTO_POLICIES } from '@/lib/shift-handover/states';

type Tab = 'products' | 'containers' | 'locations';
const POLICY_LABEL: Record<string, string> = { optional: 'Optional', recommended: 'Recommended', mandatory: 'Required' };
const POLICY_TONE: Record<string, string> = { optional: 'draft', recommended: 'confirmed', mandatory: 'overdue' };

export function Configuration({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('products');
  const [cfg, setCfg] = useState<any>(null);
  const [sheet, setSheet] = useState<null | Tab>(null);

  const load = useCallback(() => { apiGet('/api/shift-handover/config').then(setCfg).catch(() => setCfg({ products: [], container_types: [], locations: [] })); }, []);
  useEffect(load, [load]);

  const flatLocs: FlatLocation[] = flattenTree(cfg?.locations || []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="Configuration" subtitle="Products, containers & storage" showBack onBack={onBack}
        action={<button onClick={() => setSheet(tab)} className="bg-white/15 text-white text-[var(--fs-sm)] font-semibold rounded-xl px-3 h-10 active:bg-white/25">+ Add</button>} />
      <div className="pt-3">
        <FilterBar>
          <FilterPill active={tab === 'products'} label="Products" onClick={() => setTab('products')} />
          <FilterPill active={tab === 'containers'} label="Containers" onClick={() => setTab('containers')} />
          <FilterPill active={tab === 'locations'} label="Locations" onClick={() => setTab('locations')} />
        </FilterBar>
      </div>

      <div className="flex-1 px-4 py-2">
        {!cfg ? <Spinner /> : tab === 'products' ? (
          <div className="flex flex-col gap-2">
            {cfg.products.map((p: any) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div><div className="text-[var(--fs-base)] font-bold text-gray-900">{p.name}</div><div className="text-[var(--fs-xs)] text-gray-400">{KIND_LABELS[p.kind] || p.kind}{p.active ? '' : ' · inactive'}</div></div>
                  <Chip tone={POLICY_TONE[p.photo_policy]}>Photo: {POLICY_LABEL[p.photo_policy]}</Chip>
                </div>
                <div className="flex gap-1.5">
                  {PHOTO_POLICIES.map((pol) => (
                    <button key={pol} onClick={() => apiSend('/api/shift-handover/products', 'PATCH', { id: p.id, photo_policy: pol }).then(load)}
                      className={`px-3 h-9 rounded-lg text-[var(--fs-xs)] font-semibold border ${p.photo_policy === pol ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>{POLICY_LABEL[pol]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'containers' ? (
          <div className="flex flex-col gap-2">
            {cfg.container_types.map((t: any) => (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center justify-between">
                <div><div className="text-[var(--fs-base)] font-semibold text-gray-900">{t.name}</div><div className="text-[var(--fs-xs)] text-gray-400">{[t.category, t.capacity_label].filter(Boolean).join(' · ')}</div></div>
                {!t.active && <Chip tone="draft">inactive</Chip>}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {flatLocs.map((l) => (
              <div key={l.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-sm)]" style={{ marginLeft: depthOf(l, flatLocs) * 16 }}>
                {l.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {sheet && <AddSheet tab={sheet} locations={flatLocs} onClose={() => setSheet(null)} onAdded={() => { setSheet(null); load(); }} />}
    </div>
  );
}

function AddSheet({ tab, locations, onClose, onAdded }: { tab: Tab; locations: FlatLocation[]; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('finished');
  const [policy, setPolicy] = useState('optional');
  const [parentId, setParentId] = useState<number | null>(null);
  const { busy, error, run } = useAsync();

  async function add() {
    let url = '', body: any = { name };
    if (tab === 'products') { url = '/api/shift-handover/products'; body = { name, kind, photo_policy: policy }; }
    else if (tab === 'containers') { url = '/api/shift-handover/container-types'; body = { name }; }
    else { url = '/api/shift-handover/locations'; body = { name, parent_id: parentId }; }
    const res = await run(() => apiSend(url, 'POST', body));
    if (res) onAdded();
  }
  const title = tab === 'products' ? 'New product' : tab === 'containers' ? 'New container type' : 'New storage location';

  return (
    <Sheet title={title} onClose={onClose} footer={<PrimaryButton onClick={add} busy={busy} disabled={!name.trim()}>Add</PrimaryButton>}>
      <ErrorNote>{error}</ErrorNote>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" placeholder="Name" /></Field>
      {tab === 'products' && (
        <>
          <Field label="Kind"><OptionGrid cols={3} value={kind} options={[{ value: 'finished', label: 'Finished' }, { value: 'component', label: 'Component' }, { value: 'other', label: 'Other' }]} onChange={setKind} /></Field>
          <Field label="Photo requirement"><OptionGrid cols={3} value={policy} options={PHOTO_POLICIES.map((p) => ({ value: p, label: POLICY_LABEL[p] }))} onChange={setPolicy} /></Field>
        </>
      )}
      {tab === 'locations' && locations.length > 0 && (
        <Field label="Inside (optional parent)"><Select value={parentId} onChange={(v) => setParentId(v ? parseInt(v, 10) : null)} options={buildLocationOptions(locations)} placeholder="(top level)" /></Field>
      )}
    </Sheet>
  );
}

// Config returns locations as a tree; flatten for display/pickers.
function flattenTree(tree: any[], out: FlatLocation[] = []): FlatLocation[] {
  for (const n of tree) { out.push({ id: n.id, parent_id: n.parent_id, name: n.name }); if (n.children?.length) flattenTree(n.children, out); }
  return out;
}
function depthOf(l: FlatLocation, all: FlatLocation[]): number {
  let d = 0; let cur = l.parent_id; const byId = new Map(all.map((x) => [x.id, x])); const seen = new Set<number>();
  while (cur != null && !seen.has(cur)) { seen.add(cur); d++; cur = byId.get(cur)?.parent_id ?? null; }
  return d;
}
