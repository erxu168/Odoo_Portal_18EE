'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, FilterBar, FilterPill } from '@/components/inventory/ui';
import { Chip, OptionGrid, Field, Select, PrimaryButton, ErrorNote, Sheet, buildLocationOptions, apiGet, apiSend, useAsync, type FlatLocation } from './common';
import { KIND_LABELS } from '@/lib/shift-handover/labels';
import { PHOTO_POLICIES } from '@/lib/shift-handover/states';

type Tab = 'products' | 'containers' | 'locations';
interface FlatLoc extends FlatLocation { active?: boolean }
const POLICY_LABEL: Record<string, string> = { optional: 'Optional', recommended: 'Recommended', mandatory: 'Required' };
const POLICY_TONE: Record<string, string> = { optional: 'draft', recommended: 'confirmed', mandatory: 'overdue' };
const ENDPOINT: Record<Tab, string> = {
  products: '/api/shift-handover/products',
  containers: '/api/shift-handover/container-types',
  locations: '/api/shift-handover/locations',
};

function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 active:bg-gray-100 flex-shrink-0" aria-label="Edit">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></svg>
    </button>
  );
}

export function Configuration({ companyPill, onBack }: { companyPill?: React.ReactNode; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('products');
  const [cfg, setCfg] = useState<any>(null);
  // { tab, item } — item null = add, item set = edit.
  const [sheet, setSheet] = useState<{ tab: Tab; item: any | null } | null>(null);

  const load = useCallback(() => { apiGet('/api/shift-handover/config').then(setCfg).catch(() => setCfg({ products: [], container_types: [], locations: [] })); }, []);
  useEffect(load, [load]);

  const flatLocs: FlatLoc[] = flattenTree(cfg?.locations || []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader supertitle="SHIFT HANDOVER" title="Configuration" subtitle="Products, containers & storage" showBack onBack={onBack}
        action={
          <div className="flex items-center gap-1.5">
            {companyPill}
            <button onClick={() => setSheet({ tab, item: null })} className="bg-white/15 text-white text-[var(--fs-sm)] font-semibold rounded-xl px-3 h-10 active:bg-white/25">+ Add</button>
          </div>
        } />
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
              <div key={p.id} className={`bg-white border border-gray-200 rounded-2xl p-3.5 ${p.active ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="min-w-0"><div className="text-[var(--fs-base)] font-bold text-gray-900 truncate">{p.name}</div><div className="text-[var(--fs-xs)] text-gray-400">{KIND_LABELS[p.kind] || p.kind}{p.active ? '' : ' · hidden'}</div></div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Chip tone={POLICY_TONE[p.photo_policy]}>Photo: {POLICY_LABEL[p.photo_policy]}</Chip>
                    <EditBtn onClick={() => setSheet({ tab: 'products', item: p })} />
                  </div>
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
              <div key={t.id} className={`bg-white border border-gray-200 rounded-xl p-3.5 flex items-center justify-between gap-2 ${t.active ? '' : 'opacity-60'}`}>
                <div className="min-w-0"><div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{t.name}</div><div className="text-[var(--fs-xs)] text-gray-400">{[t.category, t.capacity_label].filter(Boolean).join(' · ') || '—'}</div></div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!t.active && <Chip tone="draft">hidden</Chip>}
                  <EditBtn onClick={() => setSheet({ tab: 'containers', item: t })} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {flatLocs.map((l) => (
              <div key={l.id} className={`bg-white border border-gray-200 rounded-xl pl-4 pr-1 py-1 flex items-center justify-between gap-2 ${l.active === false ? 'opacity-60' : ''}`} style={{ marginLeft: depthOf(l, flatLocs) * 16 }}>
                <span className="text-[var(--fs-sm)] text-gray-900 py-2 truncate">{l.name}{l.active === false ? ' · hidden' : ''}</span>
                <EditBtn onClick={() => setSheet({ tab: 'locations', item: l })} />
              </div>
            ))}
          </div>
        )}
      </div>

      {sheet && <EntrySheet tab={sheet.tab} item={sheet.item} locations={flatLocs} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
    </div>
  );
}

function EntrySheet({ tab, item, locations, onClose, onSaved }: { tab: Tab; item: any | null; locations: FlatLoc[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!item;
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState(item?.kind ?? 'finished');
  const [policy, setPolicy] = useState(item?.photo_policy ?? 'optional');
  const [category, setCategory] = useState(item?.category ?? '');
  const [capacity, setCapacity] = useState(item?.capacity_label ?? '');
  const [parentId, setParentId] = useState<number | null>(item?.parent_id ?? null);
  const [armed, setArmed] = useState(false);
  const { busy, error, setError, run } = useAsync();
  const endpoint = ENDPOINT[tab];

  async function save() {
    let body: any;
    if (tab === 'products') body = editing ? { id: item.id, name, kind, photo_policy: policy } : { name, kind, photo_policy: policy };
    else if (tab === 'containers') body = editing ? { id: item.id, name, category: category || null, capacity_label: capacity || null } : { name, category: category || null, capacity_label: capacity || null };
    else body = editing ? { id: item.id, name } : { name, parent_id: parentId };
    const res = await run(() => apiSend(endpoint, editing ? 'PATCH' : 'POST', body));
    if (res) onSaved();
  }

  async function del() {
    setError(null);
    if (!armed) { setArmed(true); return; }
    const res = await run(() => apiSend(`${endpoint}?id=${item.id}`, 'DELETE'));
    if (res) onSaved(); else setArmed(false); // e.g. 409 "in use" — show the message, disarm
  }

  const noun = tab === 'products' ? 'product' : tab === 'containers' ? 'container type' : 'storage location';
  const footer = (
    <div className="flex flex-col gap-2">
      <PrimaryButton onClick={save} busy={busy} disabled={!name.trim()}>{editing ? 'Save changes' : 'Add'}</PrimaryButton>
      {editing && (
        <button onClick={del} disabled={busy}
          className={`w-full h-11 rounded-xl border font-semibold text-[var(--fs-sm)] disabled:opacity-50 ${armed ? 'bg-red-600 border-red-600 text-white active:bg-red-700' : 'border-red-200 text-red-600 active:bg-red-50'}`}>
          {armed ? `Tap again to delete this ${noun}` : `Delete ${noun}`}
        </button>
      )}
    </div>
  );

  return (
    <Sheet title={`${editing ? 'Edit' : 'New'} ${noun}`} onClose={onClose} footer={footer}>
      <ErrorNote>{error}</ErrorNote>
      <Field label="Name"><input value={name} onChange={(e) => { setName(e.target.value); setArmed(false); }} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" placeholder="Name" /></Field>
      {tab === 'products' && (
        <>
          <Field label="Kind"><OptionGrid cols={3} value={kind} options={[{ value: 'finished', label: 'Finished' }, { value: 'component', label: 'Component' }, { value: 'other', label: 'Other' }]} onChange={setKind} /></Field>
          <Field label="Photo requirement"><OptionGrid cols={3} value={policy} options={PHOTO_POLICIES.map((p) => ({ value: p, label: POLICY_LABEL[p] }))} onChange={setPolicy} /></Field>
        </>
      )}
      {tab === 'containers' && (
        <>
          <Field label="Category (optional)"><input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" placeholder="e.g. gastronorm, plastic" /></Field>
          <Field label="Capacity label (optional)"><input value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 outline-none focus:border-green-600" placeholder="e.g. Half pan, 5 L" /></Field>
        </>
      )}
      {tab === 'locations' && !editing && locations.length > 0 && (
        <Field label="Inside (optional parent)"><Select value={parentId} onChange={(v) => setParentId(v ? parseInt(v, 10) : null)} options={buildLocationOptions(locations)} placeholder="(top level)" /></Field>
      )}
    </Sheet>
  );
}

// Config returns locations as a tree; flatten for display/pickers.
function flattenTree(tree: any[], out: FlatLoc[] = []): FlatLoc[] {
  for (const n of tree) { out.push({ id: n.id, parent_id: n.parent_id, name: n.name, active: n.active }); if (n.children?.length) flattenTree(n.children, out); }
  return out;
}
function depthOf(l: FlatLoc, all: FlatLoc[]): number {
  let d = 0; let cur = l.parent_id; const byId = new Map(all.map((x) => [x.id, x])); const seen = new Set<number>();
  while (cur != null && !seen.has(cur)) { seen.add(cur); d++; cur = byId.get(cur)?.parent_id ?? null; }
  return d;
}
