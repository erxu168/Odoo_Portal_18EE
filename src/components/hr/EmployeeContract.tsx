'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Props {
  employeeId: number;
  onBack: () => void;
  onHome: () => void;
  onSaved: () => void;
}

interface Option { id: number; name: string; }

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft (not active yet)' },
  { value: 'open', label: 'Running (active)' },
  { value: 'close', label: 'Ended' },
];

export default function EmployeeContract({ employeeId, onBack, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [empName, setEmpName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contractId, setContractId] = useState<number | null>(null);
  const [canEditPay, setCanEditPay] = useState(false);
  const [contractTypes, setContractTypes] = useState<Option[]>([]);
  const [calendars, setCalendars] = useState<Option[]>([]);

  // Form fields
  const [state, setState] = useState('open');
  const [contractTypeId, setContractTypeId] = useState<number | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState('');
  const [calendarId, setCalendarId] = useState<number | null>(null);

  // Pay (admins only)
  const [wageType, setWageType] = useState<'hourly' | 'monthly'>('hourly');
  const [hourlyWage, setHourlyWage] = useState('');
  const [monthlyWage, setMonthlyWage] = useState('');

  useEffect(() => {
    fetch(`/api/hr/employee/${employeeId}/contract`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setEmpName(d.employee?.name || '');
        setCompanyName(d.employee?.company_name || '');
        setCanEditPay(!!d.canEditPay);
        setContractTypes(d.options?.contractTypes || []);
        setCalendars(d.options?.calendars || []);
        const c = d.contract;
        if (c) {
          setContractId(c.id);
          setState(c.state || 'open');
          setContractTypeId(c.contract_type_id ?? null);
          setDateStart(c.date_start || '');
          setDateEnd(c.date_end || '');
          setWeeklyHours(c.weekly_hours ? String(c.weekly_hours) : '');
          setDaysPerWeek(c.days_per_week ? String(c.days_per_week) : '');
          setCalendarId(c.resource_calendar_id ?? null);
          if (d.canEditPay) {
            setWageType(c.wage_type === 'monthly' ? 'monthly' : 'hourly');
            setHourlyWage(c.hourly_wage ? String(c.hourly_wage) : '');
            setMonthlyWage(c.wage ? String(c.wage) : '');
          }
        }
      })
      .catch(() => setError('Could not load the contract.'))
      .finally(() => setLoading(false));
  }, [employeeId]);

  const isNew = contractId === null;

  async function handleSubmit() {
    setError(null);
    if (!dateStart) { setError('Please choose a start date.'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        contract_id: contractId,
        state,
        contract_type_id: contractTypeId,
        date_start: dateStart,
        date_end: dateEnd || null,
        weekly_hours: weeklyHours ? Number(weeklyHours) : 0,
        days_per_week: daysPerWeek ? Number(daysPerWeek) : 0,
        resource_calendar_id: calendarId,
      };
      if (canEditPay) {
        payload.wage_type = wageType;
        payload.hourly_wage = hourlyWage ? Number(hourlyWage) : 0;
        payload.wage = monthlyWage ? Number(monthlyWage) : 0;
      }
      const res = await fetch(`/api/hr/employee/${employeeId}/contract`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppHeader title="Contract & hours" subtitle={empName} showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {isNew && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[var(--fs-sm)]">
              No contract on file yet for {empName || 'this person'}. Fill this in to create one.
            </div>
          )}

          <Card title="Employment">
            <Field label="Status">
              <select value={state} onChange={e => setState(e.target.value)} className="form-inp appearance-none">
                {STATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Contract type (optional)">
              <select value={contractTypeId ?? ''} onChange={e => setContractTypeId(e.target.value ? parseInt(e.target.value) : null)}
                className="form-inp appearance-none">
                <option value="">No type</option>
                {contractTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <div className="flex gap-3">
              <Field label="Start date" className="flex-1">
                <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="form-inp" />
              </Field>
              <Field label="End date (optional)" className="flex-1">
                <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="form-inp" />
              </Field>
            </div>
          </Card>

          <Card title="Working hours">
            <div className="flex gap-3">
              <Field label="Hours / week" className="flex-1">
                <input type="number" inputMode="decimal" step="0.5" min="0" value={weeklyHours}
                  onChange={e => setWeeklyHours(e.target.value)} placeholder="e.g. 20" className="form-inp" />
              </Field>
              <Field label="Days / week" className="flex-1">
                <input type="number" inputMode="numeric" step="1" min="0" max="7" value={daysPerWeek}
                  onChange={e => setDaysPerWeek(e.target.value)} placeholder="e.g. 5" className="form-inp" />
              </Field>
            </div>
            <Field label="Working schedule (optional)">
              <select value={calendarId ?? ''} onChange={e => setCalendarId(e.target.value ? parseInt(e.target.value) : null)}
                className="form-inp appearance-none">
                <option value="">Not set</option>
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </Card>

          {canEditPay ? (
            <Card title="Pay (admins only)">
              <Field label="Wage type">
                <select value={wageType} onChange={e => setWageType(e.target.value as 'hourly' | 'monthly')} className="form-inp appearance-none">
                  <option value="hourly">Hourly</option>
                  <option value="monthly">Fixed monthly</option>
                </select>
              </Field>
              {wageType === 'hourly' ? (
                <Field label="Hourly rate (€)">
                  <input type="number" inputMode="decimal" step="0.01" min="0" value={hourlyWage}
                    onChange={e => setHourlyWage(e.target.value)} placeholder="e.g. 13.90" className="form-inp" />
                </Field>
              ) : (
                <Field label="Monthly wage (€)">
                  <input type="number" inputMode="decimal" step="0.01" min="0" value={monthlyWage}
                    onChange={e => setMonthlyWage(e.target.value)} placeholder="e.g. 2500.00" className="form-inp" />
                </Field>
              )}
            </Card>
          ) : (
            <p className="text-[var(--fs-xs)] text-gray-400 px-1">Pay details are managed by an admin.</p>
          )}

          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}
        </div>
      )}

      {!loading && !error && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
            {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (isNew ? 'Create contract' : 'Save changes')}
          </button>
        </div>
      )}

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-200 flex flex-col gap-3">
      <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400">{title}</div>
      {children}
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
