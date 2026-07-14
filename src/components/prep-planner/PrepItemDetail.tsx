'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PrepItemForm, { PrepItemFormValues } from './PrepItemForm';
import { DEFAULT_COMPANY_ID } from './companies';

interface PrepItem {
  id: number;
  company_id: number;
  name: string;
  station: string | null;
  prep_type: 'advance' | 'batch' | 'ondemand' | null;
  prep_time_min: number | null;
  max_holding_min: number | null;
  batch_size: number | null;
  unit: string;
  active: number;
  notes: string | null;
}

interface PrepLink {
  id: number;
  prep_item_id: number;
  pos_product_id: number;
  pos_product_name: string;
  portions_per_sale: number;
  notes: string | null;
}

const PREP_TYPE_META: Record<string, { label: string; dot: string }> = {
  ondemand: { label: 'Start now',  dot: 'bg-red-500' },
  batch:    { label: 'Batch',      dot: 'bg-amber-500' },
  advance:  { label: 'Plate',      dot: 'bg-green-500' },
};

export default function PrepItemDetail({ itemId }: { itemId: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const companyId = Number(search.get('companyId')) || DEFAULT_COMPANY_ID;

  const [item, setItem] = useState<PrepItem | null>(null);
  const [links, setLinks] = useState<PrepLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Link form state
  const [linkForm, setLinkForm] = useState({
    pos_product_id: '',
    pos_product_name: '',
    portions_per_sale: '1',
    notes: '',
  });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prep-planner/items/${itemId}`);
      const data = await res.json();
      if (data.item) {
        setItem(data.item);
        setLinks(data.links || []);
      }
    } catch (err) {
      console.error('[prep-planner] detail load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkErr(null);
    const posId = parseInt(linkForm.pos_product_id, 10);
    const portions = parseFloat(linkForm.portions_per_sale);
    if (!Number.isFinite(posId) || posId <= 0) {
      setLinkErr('POS product ID must be a positive number');
      return;
    }
    if (!linkForm.pos_product_name.trim()) {
      setLinkErr('POS product name is required');
      return;
    }
    if (!Number.isFinite(portions) || portions <= 0) {
      setLinkErr('Portions per sale must be > 0');
      return;
    }
    setLinkSaving(true);
    try {
      const res = await fetch('/api/prep-planner/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prep_item_id: itemId,
          pos_product_id: posId,
          pos_product_name: linkForm.pos_product_name.trim(),
          portions_per_sale: portions,
          notes: linkForm.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Add link failed');
      setLinkForm({ pos_product_id: '', pos_product_name: '', portions_per_sale: '1', notes: '' });
      await load();
    } catch (err) {
      setLinkErr(err instanceof Error ? err.message : 'Add link failed');
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleRemoveLink(linkId: number) {
    if (!confirm('Remove this POS link?')) return;
    try {
      const res = await fetch(`/api/prep-planner/links?id=${linkId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await load();
    } catch (err) {
      console.error('[prep-planner] link delete failed:', err);
    }
  }

  async function handleDeleteItem() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/prep-planner/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      router.push(`/prep-planner/items?companyId=${companyId}`);
    } catch (err) {
      console.error('[prep-planner] item delete failed:', err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Loading\u2026" showBack onBack={() => router.back()} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-cyan-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not found" showBack onBack={() => router.back()} />
        <div className="p-8 text-center text-gray-500">This prep item doesn&apos;t exist.</div>
      </div>
    );
  }

  if (mode === 'edit') {
    const initial: PrepItemFormValues = {
      name: item.name,
      station: item.station || '',
      prep_type: item.prep_type || '',
      prep_time_min: item.prep_time_min != null ? String(item.prep_time_min) : '',
      max_holding_min: item.max_holding_min != null ? String(item.max_holding_min) : '',
      batch_size: item.batch_size != null ? String(item.batch_size) : '',
      unit: item.unit || 'portion',
      notes: item.notes || '',
      active: item.active === 1,
    };
    return (
      <PrepItemForm
        mode="edit"
        companyId={companyId}
        itemId={itemId}
        initial={initial}
        onSaved={async () => {
          await load();
          setMode('view');
        }}
      />
    );
  }

  const meta = item.prep_type ? PREP_TYPE_META[item.prep_type] : null;

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-28">
      <AppHeader
        supertitle="PREP ITEM"
        title={item.name}
        subtitle={item.station || '\u2014'}
        showBack
        onBack={() => router.push(`/prep-planner/items?companyId=${companyId}`)}
      />

      <div className="px-4 py-4 space-y-4">
        {/* Overview */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          {meta && (
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <span className="text-[13px] font-semibold text-gray-700">{meta.label}</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <StatCell label="Prep" value={item.prep_time_min != null ? `${item.prep_time_min}m` : '\u2014'} />
            <StatCell label="Hold" value={item.max_holding_min != null ? `${item.max_holding_min}m` : '\u2014'} />
            <StatCell label="Batch" value={item.batch_size != null ? `${item.batch_size}` : '\u2014'} />
          </div>
          {item.notes && <div className="text-[13px] text-gray-700 pt-1">{item.notes}</div>}
          {item.active !== 1 && (
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 pt-1">Inactive</div>
          )}
        </div>

        {/* Linked POS products */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Linked POS products</div>
            <div className="text-[11px] text-gray-500">{links.length}</div>
          </div>
          {links.length === 0 ? (
            <div className="px-4 pb-4 text-[13px] text-gray-500">
              Link one or more POS products. The forecast sums their sales, multiplied by portions per sale.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {links.map(link => (
                <div key={link.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-gray-900 truncate">{link.pos_product_name}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      POS #{link.pos_product_id} \u00b7 {link.portions_per_sale}\u00d7 per sale
                      {link.notes && ` \u00b7 ${link.notes}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveLink(link.id)}
                    className="text-red-600 text-[12px] font-semibold px-2 py-1 rounded active:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add-link form */}
          <form onSubmit={handleAddLink} className="px-4 pt-3 pb-4 space-y-2 border-t border-gray-100 bg-gray-50">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-500">Add link</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="POS ID"
                value={linkForm.pos_product_id}
                onChange={e => setLinkForm({ ...linkForm, pos_product_id: e.target.value })}
                className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-[13px]"
              />
              <input
                type="number"
                step="0.1"
                placeholder="Portions/sale"
                value={linkForm.portions_per_sale}
                onChange={e => setLinkForm({ ...linkForm, portions_per_sale: e.target.value })}
                className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-[13px]"
              />
            </div>
            <input
              type="text"
              placeholder="POS product name"
              value={linkForm.pos_product_name}
              onChange={e => setLinkForm({ ...linkForm, pos_product_name: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-[13px]"
            />
            <input
              type="text"
              placeholder="Notes (optional, e.g. 'set menu for 4')"
              value={linkForm.notes}
              onChange={e => setLinkForm({ ...linkForm, notes: e.target.value })}
              className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-[13px]"
            />
            {linkErr && <div className="text-[12px] text-red-700">{linkErr}</div>}
            <button
              type="submit"
              disabled={linkSaving}
              className="w-full h-10 rounded-lg bg-cyan-600 text-white font-semibold text-[13px] active:scale-[0.98] disabled:opacity-50"
            >
              {linkSaving ? 'Adding\u2026' : 'Add link'}
            </button>
          </form>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('edit')}
            className="h-12 rounded-xl bg-white border border-gray-200 shadow-sm text-[14px] font-semibold text-gray-900 active:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="h-12 rounded-xl bg-white border border-red-200 shadow-sm text-[14px] font-semibold text-red-600 active:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete prep item?"
          message={`"${item.name}" and all its POS links will be removed. This also removes any forecasts tied to this item.`}
          confirmLabel={deleting ? 'Deleting\u2026' : 'Delete'}
          variant="danger"
          onConfirm={handleDeleteItem}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center bg-gray-50 rounded-lg py-2">
      <div className="text-[16px] font-bold text-gray-900">{value}</div>
      <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
