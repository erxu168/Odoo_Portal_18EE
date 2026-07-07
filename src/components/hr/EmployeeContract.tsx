'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface Props {
  employeeId: number;
  onBack: () => void;
  onHome: () => void;
  onSaved: () => void;
}

interface Option { id: number; name: string; }

interface ContractRow {
  id: number;
  name: string;
  date_start: string;
  date_end: string;
  state: string;
  contract_type_id: number | null;
  resource_calendar_id: number | null;
  weekly_hours: number;
  days_per_week: number;
  wage_type?: string;
  hourly_wage?: number;
  wage?: number;
}

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft (not active yet)' },
  { value: 'open', label: 'Running (active)' },
  { value: 'close', label: 'Ended' },
];

// YYYY-MM-DD -> DD.MM.YYYY (German display).
function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

function berlinTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

function StatusBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: 'Running', cls: 'bg-green-50 text-green-700' },
    draft: { label: 'Draft', cls: 'bg-amber-50 text-amber-700' },
    close: { label: 'Ended', cls: 'bg-gray-100 text-gray-500' },
    cancel: { label: 'Cancelled', cls: 'bg-red-50 text-red-600' },
  };
  const s = map[state] || map.draft;
  return <span className={'inline-flex px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold flex-shrink-0 ' + s.cls}>{s.label}</span>;
}

export default function EmployeeContract({ employeeId, onBack, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);      // inline action/validation error
  const [loadError, setLoadError] = useState<string | null>(null); // fatal load error (hides the form)

  const [empName, setEmpName] = useState('');
  const [contractId, setContractId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [renewing, setRenewing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  // Populate every form field from a contract row.
  const fillForm = useCallback((c: ContractRow, admin: boolean) => {
    setContractId(c.id);
    setState(c.state || 'open');
    setContractTypeId(c.contract_type_id ?? null);
    setDateStart(c.date_start || '');
    setDateEnd(c.date_end || '');
    setWeeklyHours(c.weekly_hours ? String(c.weekly_hours) : '');
    setDaysPerWeek(c.days_per_week ? String(c.days_per_week) : '');
    setCalendarId(c.resource_calendar_id ?? null);
    if (admin) {
      setWageType(c.wage_type === 'monthly' ? 'monthly' : 'hourly');
      setHourlyWage(c.hourly_wage ? String(c.hourly_wage) : '');
      setMonthlyWage(c.wage ? String(c.wage) : '');
    }
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    fetch(`/api/hr/employee/${employeeId}/contract`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setLoadError(d.error); return; }
        setEmpName(d.employee?.name || '');
        const admin = !!d.canEditPay;
        setCanEditPay(admin);
        setContractTypes(d.options?.contractTypes || []);
        setCalendars(d.options?.calendars || []);
        setContracts(d.contracts || []);
        setRenewing(false);
        const c: ContractRow | null = d.contract;
        if (c) {
          fillForm(c, admin);
        } else {
          // No contract on file yet: default the start date to today so it can be created in one tap.
          setContractId(null);
          setDateStart(berlinTodayISO());
        }
      })
      .catch(() => setLoadError('Could not load the contract.'))
      .finally(() => setLoading(false));
  }, [employeeId, fillForm]);

  useEffect(() => { load(); }, [load]);

  const noContractYet = contracts.length === 0;

  // Tap a contract in the history list to view / edit it.
  function selectContract(c: ContractRow) {
    setError(null);
    fillForm(c, canEditPay);
    setRenewing(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Begin a new contract: keep hours/pay/type/schedule, reset the dates.
  function startNew() {
    setError(null);
    setRenewing(true);
    setState('open');
    setDateStart(berlinTodayISO());
    setDateEnd('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update the currently-loaded contract in place (PUT), or create the very first one.
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

  // End the current contract and create a new one (POST). Stays on the screen and reloads
  // so the new contract becomes current and the old one drops into the history list.
  async function doRenew() {
    setShowConfirm(false);
    setError(null);
    if (!dateStart) { setError('Please choose a start date.'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start a new contract.');
      setSaving(false);
      load(); // refresh: new contract is current, old one is now in the history list
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start a new contract.');
      setSaving(false);
    }
  }

  const primaryLabel = renewing ? 'Create new contract' : (noContractYet ? 'Create contract' : 'Save changes');

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <AppHeader title="Contract & hours" subtitle={empName} showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="p-5">
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{loadError}</div>
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {renewing ? (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[var(--fs-sm)]">
              Starting a new contract. This ends the current one and keeps it in the history below. Set the new dates, then tap <b>Create new contract</b>.
            </div>
          ) : noContractYet && (
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

          {contracts.length > 1 && (
            <Card title="Contract history">
              <div className="flex flex-col gap-2">
                {contracts.map(c => {
                  const isCurrent = c.id === contractId && !renewing;
                  return (
                    <button key={c.id} type="button" disabled={renewing} onClick={() => selectContract(c)}
                      className={'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.99] disabled:opacity-50 '
                        + (isCurrent ? 'border-green-500 bg-green-50/60' : 'border-gray-200 bg-white active:bg-gray-50')}>
                      <div className="min-w-0">
                        <div className="text-[var(--fs-sm)] font-semibold text-gray-800 truncate">
                          {fmtDate(c.date_start) || '—'} – {c.date_end ? fmtDate(c.date_end) : 'ongoing'}
                        </div>
                        <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                          {c.weekly_hours ? `${c.weekly_hours} h/week` : 'hours not set'}{isCurrent ? ' · editing' : ''}
                        </div>
                      </div>
                      <StatusBadge state={c.state} />
                    </button>
                  );
                })}
              </div>
              <p className="text-[var(--fs-xs)] text-gray-400 px-1 mt-1">Tap a contract to view or edit it.</p>
            </Card>
          )}

          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>}
        </div>
      )}

      {!loading && !loadError && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent flex flex-col items-center gap-2">
          <button
            onClick={renewing
              ? () => { if (!dateStart) { setError('Please choose a start date.'); return; } setShowConfirm(true); }
              : handleSubmit}
            disabled={saving}
            className="w-full max-w-lg flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90 disabled:opacity-50">
            {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : primaryLabel}
          </button>
          {renewing ? (
            <button onClick={() => { setError(null); load(); }} disabled={saving}
              className="w-full max-w-lg py-3 rounded-xl text-[var(--fs-sm)] font-semibold text-gray-600 bg-white border border-gray-200 active:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
          ) : (!noContractYet && (
            <button onClick={startNew} disabled={saving}
              className="w-full max-w-lg py-3 rounded-xl text-[var(--fs-sm)] font-semibold text-green-700 bg-white border border-green-200 active:bg-green-50 disabled:opacity-50">
              + Start a new contract
            </button>
          ))}
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          title="Start a new contract?"
          message={`This marks ${empName || 'this person'}’s current contract as Ended and creates a new one starting ${fmtDate(dateStart)}. The old contract is kept in the history.`}
          confirmLabel="Yes, start new contract"
          cancelLabel="Cancel"
          variant="primary"
          onConfirm={doRenew}
          onCancel={() => setShowConfirm(false)}
        />
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
          box-sizing: border-box;
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
