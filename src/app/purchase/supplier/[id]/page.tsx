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
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lead, setLead] = useState('');
  const [minOrder, setMinOrder] = useState('');
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
        setEmail(s.email || ''); setPhone(s.phone || '');
        setLead(s.lead_time_days != null ? String(s.lead_time_days) : '');
        setMinOrder(s.min_order_value != null ? String(s.min_order_value) : '');
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load the supplier');
      } finally {
        setLoading(false);
      }
    })();
  }, [supplierId]);

  async function save() {
    if (!sup || saving) return;
    // Validate BEFORE the PATCH so we never show "Saved" for a value the backend
    // silently drops (lead-time coercer caps at 365; a malformed decimal → null).
    const leadVal = lead.trim() === '' ? 1 : Number(lead);
    const minVal = minOrder.trim() === '' ? 0 : Number(minOrder);
    if (!Number.isInteger(leadVal) || leadVal < 0 || leadVal > 365) {
      setMsg({ kind: 'err', text: 'Lead time must be a whole number of days (0–365)' }); return;
    }
    if (!Number.isFinite(minVal) || minVal < 0) {
      setMsg({ kind: 'err', text: 'Min order must be a valid amount' }); return;
    }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/purchase/suppliers', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sup.id, email: email.trim(), phone: phone.trim(), lead_time_days: leadVal, min_order_value: minVal }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg({ kind: 'err', text: d.error || 'Could not save' }); return; }
      // Reflect exactly the values sent (leadVal 0 stays 0, not coerced to 1).
      setSup({ ...sup, email: email.trim(), phone: phone.trim(), lead_time_days: leadVal, min_order_value: minVal });
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
  const box = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50 outline-none focus:border-green-500';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Supplier" subtitle={sup.name} showBack onBack={back}
        action={canEdit && !editing ? (
          <button onClick={() => setEditing(true)} className="text-white/90 text-[13px] font-bold active:opacity-70">Edit</button>
        ) : undefined} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <h1 className="text-[22px] font-bold text-gray-900 mb-1">{sup.name}</h1>
        {sup.active === 0 && <span className="text-[10px] font-bold uppercase text-gray-500 bg-gray-100 rounded-md px-2 py-0.5">Inactive</span>}
        {msg && <span className={`ml-2 text-[12px] font-bold ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}

        {editing ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 my-4">
            <label className={sectionLabel}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${box} mb-3`} inputMode="email" />
            <label className={sectionLabel}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={`${box} mb-3`} inputMode="tel" />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={sectionLabel}>Lead time (days)</label>
                <input value={lead} onChange={(e) => setLead(e.target.value.replace(/[^0-9]/g, ''))} className={box} inputMode="numeric" />
              </div>
              <div className="flex-1">
                <label className={sectionLabel}>Min order (€)</label>
                <input value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^0-9.]/g, ''))} className={box} inputMode="decimal" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setEmail(sup.email || ''); setPhone(sup.phone || ''); setLead(String(sup.lead_time_days ?? '')); setMinOrder(String(sup.min_order_value ?? '')); setMsg(null); }}
                className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-bold">Cancel</button>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
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
