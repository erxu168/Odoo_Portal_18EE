'use client';

/**
 * Edit the operational facts of a termination — delivery method/dates, receipt,
 * confirmation date, tracking, witness, notes, last working day. Letter content
 * (type, letter date, severance…) is deliberately NOT here: after confirmation
 * it only changes by cancelling and redoing the letter.
 */
import React, { useState } from 'react';
import type { TerminationRecord, DeliveryMethod } from '@/types/termination';
import { DELIVERY_METHOD_LABELS } from '@/types/termination';

interface Props {
  rec: TerminationRecord;
  onSaved: (updated: TerminationRecord) => void;
  onCancel: () => void;
}

const d = (v: string | false | undefined) => (typeof v === 'string' ? v : '');

export default function TerminationEditForm({ rec, onSaved, onCancel }: Props) {
  const [method, setMethod] = useState<DeliveryMethod | ''>(rec.delivery_method || '');
  const [sentOn, setSentOn] = useState(d(rec.delivery_date));
  const [tracking, setTracking] = useState(d(rec.delivery_tracking_number as string | false));
  const [witness, setWitness] = useState(d(rec.delivery_witness as string | false));
  const [receipt, setReceipt] = useState(d(rec.receipt_date));
  const [confirmedOn, setConfirmedOn] = useState(d(rec.delivery_confirmed_date));
  const [lastDay, setLastDay] = useState(d(rec.last_working_day));
  const [notes, setNotes] = useState(d(rec.delivery_notes as string | false));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/termination/${rec.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_method: method || false,
          delivery_date: sentOn || false,
          delivery_tracking_number: tracking || false,
          delivery_witness: witness || false,
          receipt_date: receipt || false,
          delivery_confirmed_date: confirmedOn || false,
          last_working_day: lastDay || false,
          delivery_notes: notes || false,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setErr(json.error || 'Could not save.'); setBusy(false); return; }
      onSaved(json.data);
    } catch { setErr('Could not save.'); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center sm:justify-center" onClick={onCancel}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-[19px] font-extrabold text-gray-900 mb-1">Edit details</h3>
        <p className="text-[12px] text-gray-500 mb-4">
          Operational facts only — the letter itself does not change. Edits are logged in the record history.
        </p>

        <L>Delivery method</L>
        <select value={method} onChange={e => setMethod(e.target.value as DeliveryMethod | '')} className={inp}>
          <option value="">—</option>
          {(Object.keys(DELIVERY_METHOD_LABELS) as DeliveryMethod[]).map(k => (
            <option key={k} value={k}>{DELIVERY_METHOD_LABELS[k]}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><L>Sent on</L><input type="date" value={sentOn} onChange={e => setSentOn(e.target.value)} className={inp} /></div>
          <div><L>Receipt date</L><input type="date" value={receipt} onChange={e => setReceipt(e.target.value)} className={inp} /></div>
          <div><L>Confirmed on</L><input type="date" value={confirmedOn} onChange={e => setConfirmedOn(e.target.value)} className={inp} /></div>
          <div><L>Last working day</L><input type="date" value={lastDay} onChange={e => setLastDay(e.target.value)} className={inp} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div><L>Tracking number</L><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="RR 1234 5678 9 DE" className={inp} /></div>
          <div><L>Witness</L><input value={witness} onChange={e => setWitness(e.target.value)} className={inp} /></div>
        </div>

        <div className="mt-3"><L>Notes</L>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inp} />
        </div>

        {err && <p className="text-[13px] text-red-600 mt-3">{err}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 rounded-2xl border border-gray-200 text-gray-600 font-semibold py-3">Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 rounded-2xl bg-green-600 text-white font-bold py-3 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-green-600';
function L({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{children}</div>;
}
