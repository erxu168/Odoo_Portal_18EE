'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onSaved: () => void;
}

interface EmpOption { id: number; name: string; }
interface TypeOption { id: number; name: string; requires_allocation: boolean; remaining: number | null; }

export default function TimeOffRequest({ onBack, onSaved }: Props) {
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    fetch('/api/hr/employees')
      .then(r => r.json())
      .then(d => setEmployees((d.employees || []).map((e: { id: number; name: string }) => ({ id: e.id, name: e.name }))))
      .catch(() => {});
  }, []);

  // Load leave types + balances whenever the employee changes.
  useEffect(() => {
    setTypeId(null);
    setTypes([]);
    if (!employeeId) return;
    setLoadingTypes(true);
    fetch(`/api/hr/timeoff/types?employee_id=${employeeId}`)
      .then(r => r.json())
      .then(d => setTypes(d.types || []))
      .catch(() => {})
      .finally(() => setLoadingTypes(false));
  }, [employeeId]);

  async function handleSubmit() {
    setError(null);
    if (!employeeId) { setError('Please choose a staff member.'); return; }
    if (!typeId) { setError('Please choose a time-off type.'); return; }
    if (!from || !to) { setError('Please choose the dates.'); return; }
    if (to < from) { setError('The end date is before the start date.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/hr/timeoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, holiday_status_id: typeId, request_date_from: from, request_date_to: to, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the request.');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create the request.');
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppHeader title="Request time off" showBack onBack={onBack} />

      <div className="p-5 flex flex-col gap-4">
        <Field label="Staff member">
          <select value={employeeId ?? ''} onChange={e => setEmployeeId(e.target.value ? parseInt(e.target.value) : null)}
            className="form-inp appearance-none">
            <option value="">Choose a staff member…</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>

        <Field label="Type of time off">
          <select value={typeId ?? ''} onChange={e => setTypeId(e.target.value ? parseInt(e.target.value) : null)}
            disabled={!employeeId || loadingTypes} className="form-inp appearance-none disabled:opacity-50">
            <option value="">{!employeeId ? 'Pick a staff member first' : loadingTypes ? 'Loading…' : 'Choose a type…'}</option>
            {types.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.remaining !== null ? ` (${t.remaining} left)` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex gap-3">
          <Field label="From" className="flex-1">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-inp" />
          </Field>
          <Field label="To" className="flex-1">
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-inp" />
          </Field>
        </div>

        <Field label="Reason (optional)">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Family holiday" className="form-inp" />
        </Field>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}

        <p className="text-[var(--fs-xs)] text-gray-400 px-1">
          The request is created as pending. Approve it from the Time Off list.
        </p>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        <button onClick={handleSubmit} disabled={saving}
          className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
          {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Create request'}
        </button>
      </div>

      <style jsx>{`
        .form-inp {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          background: #fff;
          font-size: var(--fs-base);
          outline: none;
        }
        .form-inp:focus { border-color: #16a34a; }
      `}</style>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={'block ' + (className || '')}>
      <span className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
