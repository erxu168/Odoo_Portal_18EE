'use client';

import React, { useState } from 'react';

/**
 * SupplierForm — the ONE form for a supplier's fields, used everywhere a
 * supplier is created or edited: the Purchase app's "Delivery settings" (edit)
 * and "Add supplier → Create new" (create), AND the canonical
 * /purchase/supplier/[id] page. Per the single-canonical-form rule, there is no
 * second supplier form.
 *
 * Presentational: the parent owns the API call (POST create / PATCH edit) and
 * passes saving/error. Validation lives HERE so every surface gets it.
 */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface SupplierFormValues {
  name: string;
  email: string;
  phone: string;
  send_method: string;
  whatsapp_number: string;
  order_days: string[];
  delivery_days: string[];
  lead_time_days: number;
  min_order_value: number;
  approval_required: number;
}

function parseDays(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

export default function SupplierForm({ mode, initial, onSave, onCancel, onDelete, saving, error, variant = 'modal' }: {
  mode: 'create' | 'edit';
  initial: Partial<{ name: string; email: string; phone: string; send_method: string; whatsapp_number: string; order_days: unknown; delivery_days: unknown; lead_time_days: number; min_order_value: number; approval_required: number }>;
  onSave: (v: SupplierFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
  error?: string | null;
  variant?: 'modal' | 'inline';
}) {
  const [name, setName] = useState(initial.name || '');
  const [email, setEmail] = useState(initial.email || '');
  const [phone, setPhone] = useState(initial.phone || '');
  const [sendMethod, setSendMethod] = useState(initial.send_method || 'email');
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp_number || '');
  const [orderDays, setOrderDays] = useState<string[]>(parseDays(initial.order_days));
  const [deliveryDays, setDeliveryDays] = useState<string[]>(parseDays(initial.delivery_days));
  const [lead, setLead] = useState<number>(Number.isFinite(initial.lead_time_days) ? Number(initial.lead_time_days) : 1);
  const [minOrder, setMinOrder] = useState<string>(initial.min_order_value != null ? String(initial.min_order_value) : '');
  const [approval, setApproval] = useState<number>(initial.approval_required ? 1 : 0);
  const [localErr, setLocalErr] = useState<string | null>(null);

  function submit() {
    const minVal = minOrder.trim() === '' ? 0 : Number(minOrder);
    if (!Number.isInteger(lead) || lead < 0 || lead > 365) { setLocalErr('Lead time must be a whole number of days (0–365)'); return; }
    if (!Number.isFinite(minVal) || minVal < 0) { setLocalErr('Min order must be a valid amount'); return; }
    setLocalErr(null);
    onSave({
      name: name.trim(), email: email.trim(), phone: phone.trim(),
      send_method: sendMethod, whatsapp_number: sendMethod === 'whatsapp' ? whatsapp.trim() : '',
      order_days: orderDays, delivery_days: deliveryDays,
      lead_time_days: lead, min_order_value: minVal, approval_required: approval,
    });
  }

  const lbl = 'text-[10px] font-bold uppercase tracking-wide text-gray-400 block mb-1.5';
  const inp = 'w-full bg-white border border-gray-200 rounded-lg px-3 h-10 text-[var(--fs-sm)] text-gray-900 outline-none focus:border-[#F5800A]';
  const dayBtn = (active: boolean) => `px-3.5 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${active ? 'bg-[#F5800A] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`;

  const body = (
    <>
      <div className="mb-3">
        <label className={lbl}>Supplier name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Supplier name" className={`${inp} mb-2.5`} />
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className={lbl}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@supplier.com" className={inp} />
          </div>
          <div className="flex-1 min-w-0">
            <label className={lbl}>Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 ..." className={inp} />
          </div>
        </div>
      </div>

      <div className="mb-3">
        <label className={lbl}>Order method <span className="normal-case font-normal">(how orders reach this supplier)</span></label>
        <div className="flex gap-1.5">
          {([['email', 'Email'], ['whatsapp', 'WhatsApp'], ['manual', 'Manual']] as const).map(([val, label]) => (
            <button key={val} onClick={() => setSendMethod(val)}
              className={`flex-1 px-3 py-2 rounded-lg text-[var(--fs-xs)] font-semibold ${sendMethod === val ? 'bg-[#F5800A] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
        {sendMethod === 'whatsapp' && (
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp number (+49 …)" className={`${inp} mt-2`} />
        )}
      </div>

      <div className="mb-3">
        <label className={lbl}>Order days <span className="normal-case font-normal">(when staff must place orders)</span></label>
        <div className="flex gap-1.5 flex-wrap">
          {WEEKDAYS.map((d) => {
            const active = orderDays.includes(d);
            return <button key={d} onClick={() => setOrderDays(active ? orderDays.filter((x) => x !== d) : [...orderDays, d])} className={dayBtn(active)}>{d.charAt(0).toUpperCase() + d.slice(1)}</button>;
          })}
        </div>
      </div>

      <div className="mb-3">
        <label className={lbl}>Delivery days <span className="normal-case font-normal">(when this supplier delivers)</span></label>
        <div className="flex gap-1.5 flex-wrap">
          {WEEKDAYS.map((d) => {
            const active = deliveryDays.includes(d);
            return <button key={d} onClick={() => setDeliveryDays(active ? deliveryDays.filter((x) => x !== d) : [...deliveryDays, d])} className={dayBtn(active)}>{d.charAt(0).toUpperCase() + d.slice(1)}</button>;
          })}
        </div>
      </div>

      <div className="mb-3 flex gap-4">
        <div>
          <label className={lbl}>Lead time <span className="normal-case font-normal">(days notice)</span></label>
          <div className="flex items-center gap-2">
            <button onClick={() => setLead(Math.max(0, lead - 1))} className="w-10 h-10 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100">-</button>
            <span className="w-12 text-center text-[var(--fs-lg)] font-bold font-mono text-gray-900">{lead}</span>
            <button onClick={() => setLead(Math.min(365, lead + 1))} className="w-10 h-10 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[18px] text-gray-600 active:bg-gray-100">+</button>
          </div>
        </div>
        <div className="flex-1">
          <label className={lbl}>Min order (€)</label>
          <input value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className={inp} />
        </div>
      </div>

      <button onClick={() => setApproval(approval ? 0 : 1)} className="w-full flex items-center justify-between mb-1">
        <span className="text-[var(--fs-sm)] font-semibold text-gray-900">Manager approval required to send</span>
        <span className={`relative w-11 h-[26px] rounded-full transition-colors ${approval ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
          <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${approval ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
        </span>
      </button>

      {(localErr || error) && <p className="text-[12px] font-semibold text-red-600 mt-2">{localErr || error}</p>}

      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-600">Cancel</button>
        <button onClick={submit} disabled={!name.trim() || !!saving}
          className="flex-1 py-3 rounded-xl bg-[#F5800A] text-white font-bold disabled:opacity-50">
          {saving ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save'}
        </button>
      </div>
      {mode === 'edit' && onDelete && <button onClick={onDelete} className="w-full mt-3 py-2.5 text-red-600 font-semibold text-sm">Remove this supplier</button>}
    </>
  );

  if (variant === 'inline') return <div>{body}</div>;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" role="dialog" aria-modal="true">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-3">{mode === 'create' ? 'New supplier' : 'Edit supplier'}</h3>
        {body}
      </div>
    </div>
  );
}
