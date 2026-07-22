'use client';

/**
 * /purchase/supplier/[id] — a supplier's canonical Form View. Part of the
 * Universal Record Drill-Down standard: any RecordLink to a supplier lands
 * here. Deep-linkable from every place a supplier name appears (order list,
 * order detail, insights, catalog). Viewing is a right of any authenticated
 * user; contact + delivery fields are editable with purchase.supplier.manage.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';
import { RECORD_EDIT_CAP } from '@/lib/record-links';
import SupplierForm, { type SupplierFormValues } from '@/components/purchase/SupplierForm';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function daysLabel(raw: unknown): string {
  let parsed: unknown = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw || '[]'); } catch { parsed = []; } }
  // Guard: JSON.parse('"mon"') yields a STRING (has .length, but .map throws).
  const days = Array.isArray(parsed) ? (parsed as number[]) : [];
  return days.length ? days.map((d) => WD[d] ?? d).join(', ') : '—';
}

export default function SupplierRecordPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supplierId = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;

  const [sup, setSup] = useState<any | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const back = () => (window.history.length > 1 ? router.back() : router.push('/purchase'));

  useEffect(() => {
    if (!Number.isInteger(supplierId) || supplierId <= 0) { setError('Invalid supplier'); setLoading(false); return; }
    (async () => {
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
        const me = d?.user;
        const caps: string[] = Array.isArray(me?.capabilities) ? me.capabilities
          : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
        setCanEdit(caps.includes(RECORD_EDIT_CAP.supplier));
      }).catch(() => {});

      try {
        const res = await fetch(`/api/purchase/suppliers?id=${supplierId}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'Supplier not found' : 'Could not load the supplier');
        const s = (await res.json()).supplier;
        setSup(s);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load the supplier');
      } finally {
        setLoading(false);
      }
    })();
  }, [supplierId]);

  // The ONE supplier form validates; here we just persist the full field set.
  async function handleSave(v: SupplierFormValues) {
    if (!sup || saving) return;
    setSaving(true); setMsg(null);
    const orderStr = JSON.stringify(v.order_days);
    const deliveryStr = JSON.stringify(v.delivery_days);
    try {
      const res = await fetch('/api/purchase/suppliers', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sup.id, email: v.email, phone: v.phone, send_method: v.send_method,
          whatsapp_number: v.whatsapp_number, order_days: orderStr, delivery_days: deliveryStr,
          lead_time_days: v.lead_time_days, min_order_value: v.min_order_value,
          approval_required: v.approval_required,
          ...(v.name.trim() ? { name: v.name.trim() } : {}),
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg({ kind: 'err', text: d.error || 'Could not save' }); return; }
      setSup({ ...sup, ...v, name: v.name.trim() || sup.name, order_days: orderStr, delivery_days: deliveryStr });
      setEditing(false); setMsg({ kind: 'ok', text: 'Saved' });
      setTimeout(() => setMsg(null), 1800);
    } catch { setMsg({ kind: 'err', text: 'Network error — not saved' }); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400">Loading…</div></div>;

  if (error || !sup) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">{error || 'Supplier not found'}</p>
        <button onClick={back} className="mt-3 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Go back</button>
      </div>
    );
  }

  const sectionLabel = 'text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Supplier" subtitle={sup.name} showBack onBack={back}
        action={canEdit ? (
          <button onClick={() => setEditing(true)} className="text-white/90 text-[13px] font-bold active:opacity-70">Edit</button>
        ) : undefined} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <h1 className="text-[22px] font-bold text-gray-900 mb-1">{sup.name}</h1>
        {sup.active === 0 && <span className="text-[10px] font-bold uppercase text-gray-500 bg-gray-100 rounded-md px-2 py-0.5">Inactive</span>}
        {msg && <span className={`ml-2 text-[12px] font-bold ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}

        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 my-4 text-[var(--fs-sm)]">
          <Row k="Email" v={sup.email || '—'} />
          <Row k="Phone" v={sup.phone || '—'} />
          <Row k="Order method" v={sup.send_method || 'email'} />
          {sup.whatsapp_number && <Row k="WhatsApp" v={sup.whatsapp_number} />}
        </div>
        <div className={sectionLabel}>Ordering</div>
        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 mb-8 text-[var(--fs-sm)]">
          <Row k="Order days" v={daysLabel(sup.order_days)} />
          <Row k="Delivery days" v={daysLabel(sup.delivery_days)} />
          <Row k="Lead time" v={`${sup.lead_time_days ?? 1} day${(sup.lead_time_days ?? 1) === 1 ? '' : 's'}`} />
          <Row k="Min order" v={sup.min_order_value ? `€${sup.min_order_value}` : '—'} />
          <Row k="Approval required" v={sup.approval_required ? 'Yes' : 'No'} />
        </div>
      </div>

      {editing && (
        <SupplierForm
          mode="edit"
          initial={sup}
          saving={saving}
          error={msg?.kind === 'err' ? msg.text : null}
          onCancel={() => { setEditing(false); setMsg(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900 font-semibold text-right truncate">{v}</span>
    </div>
  );
}
