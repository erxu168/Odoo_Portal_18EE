'use client';

import React, { useState, useCallback, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ProgressBar from '@/components/hr/ProgressBar';
import StepPersonal from '@/components/hr/StepPersonal';
import StepTax from '@/components/hr/StepTax';
import StepInsurance from '@/components/hr/StepInsurance';
import StepBank from '@/components/hr/StepBank';
import type { EmployeeData } from '@/types/hr';

interface Props {
  employeeId: number;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

const TITLES = ['Personal & address', 'Tax details', 'Health & insurance', 'Bank account', 'Residence & work'];

/**
 * Manager/admin full-record editor for one employee. Reuses the onboarding field
 * screens (Personal/Tax/Insurance/Bank) but loads + saves against the SPECIFIC
 * employee via the company-scoped /api/hr/employee/[id] (and /api/hr/bank with
 * employee_id). Skips the staff-only onboarding ceremony (consents/review).
 */
export default function EmployeeProfileEdit({ employeeId, onBack, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}`);
      const data = await res.json();
      if (res.ok) setEmployee(data.employee);
      else setError(data.error || 'Could not load this employee.');
    } catch {
      setError('Could not load this employee.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function saveFields(fields: Record<string, unknown>): Promise<boolean> {
    if (!fields || Object.keys(fields).length === 0) return true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save.'); return false; }
      await load();
      return true;
    } catch {
      setError('Could not save.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function next(fields?: Record<string, unknown>) {
    const advance = () => setStep((s) => Math.min(s + 1, TITLES.length - 1));
    if (fields && Object.keys(fields).length > 0) {
      saveFields(fields).then((ok) => { if (ok) advance(); });
    } else {
      advance();
    }
  }

  function prev() {
    if (step > 0) setStep((s) => s - 1);
    else onBack();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Edit profile" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Edit profile" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">{error || 'Could not load this employee.'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={TITLES[step]} subtitle={employee.name} showBack onBack={prev} />
      <ProgressBar currentStep={step} totalSteps={TITLES.length} label={`Step ${step + 1} of ${TITLES.length} — ${TITLES[step]}`} />

      {step === 0 && <StepPersonal employee={employee} onNext={next} saving={saving} />}
      {step === 1 && <StepTax employee={employee} onNext={next} onPrev={prev} saving={saving} />}
      {step === 2 && <StepInsurance employee={employee} onNext={next} onPrev={prev} saving={saving} />}
      {step === 3 && <StepBank employee={employee} employeeId={employeeId} onNext={next} onPrev={prev} saving={saving} />}
      {step === 4 && (
        <ResidenceWorkStep
          employee={employee}
          saving={saving}
          onPrev={prev}
          onSave={(fields) => { saveFields(fields).then((ok) => { if (ok) onDone(); }); }}
        />
      )}

      {error && (
        <div className="mx-5 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
      )}
    </div>
  );
}

// ---- Residence, work permit, health certificate (not covered by the reused steps) ----

function ResidenceWorkStep({
  employee, saving, onPrev, onSave,
}: {
  employee: EmployeeData;
  saving: boolean;
  onPrev: () => void;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const s = (v: unknown) => (v === false || v === undefined || v === null ? '' : String(v));
  const e = employee as unknown as Record<string, unknown>;

  const [startDate, setStartDate] = useState(s(e.kw_beschaeftigungsbeginn));
  const [permitType, setPermitType] = useState(s(e.kw_aufenthaltstitel_typ));
  const [passport, setPassport] = useState(s(e.passport_id));
  const [visaNo, setVisaNo] = useState(s(e.visa_no));
  const [permitNo, setPermitNo] = useState(s(e.permit_no));
  const [visaExpire, setVisaExpire] = useState(s(e.visa_expire));
  const [permitExpire, setPermitExpire] = useState(s(e.work_permit_expiration_date));
  const [healthDate, setHealthDate] = useState(s(e.kw_gesundheitszeugnis_datum));
  const [healthExpire, setHealthExpire] = useState(s(e.kw_gesundheitszeugnis_ablauf));
  const [sofortDone, setSofortDone] = useState(e.kw_sofortmeldung_done === true);

  function handleSave() {
    onSave({
      kw_beschaeftigungsbeginn: startDate || false,
      kw_aufenthaltstitel_typ: permitType || false,
      passport_id: passport || false,
      visa_no: visaNo || false,
      permit_no: permitNo || false,
      visa_expire: visaExpire || false,
      work_permit_expiration_date: permitExpire || false,
      kw_gesundheitszeugnis_datum: healthDate || false,
      kw_gesundheitszeugnis_ablauf: healthExpire || false,
      kw_sofortmeldung_done: sofortDone,
    });
  }

  return (
    <div className="pb-8">
      <div className="p-5 flex flex-col gap-4">
        <Field label="Employment start date">
          <input type="date" value={startDate} onChange={(ev) => setStartDate(ev.target.value)} className="form-inp" />
        </Field>

        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 pt-1">Residence / work permit</div>
        <Field label="Permit type">
          <input value={permitType} onChange={(ev) => setPermitType(ev.target.value)} placeholder="e.g. Aufenthaltstitel §18a" className="form-inp" />
        </Field>
        <Field label="Passport number">
          <input value={passport} onChange={(ev) => setPassport(ev.target.value)} className="form-inp" />
        </Field>
        <div className="flex gap-3">
          <Field label="Visa number" className="flex-1">
            <input value={visaNo} onChange={(ev) => setVisaNo(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Visa expires" className="flex-1">
            <input type="date" value={visaExpire} onChange={(ev) => setVisaExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>
        <div className="flex gap-3">
          <Field label="Permit number" className="flex-1">
            <input value={permitNo} onChange={(ev) => setPermitNo(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Permit expires" className="flex-1">
            <input type="date" value={permitExpire} onChange={(ev) => setPermitExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>

        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 pt-1">Health certificate (Gesundheitszeugnis)</div>
        <div className="flex gap-3">
          <Field label="Issued" className="flex-1">
            <input type="date" value={healthDate} onChange={(ev) => setHealthDate(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Expires" className="flex-1">
            <input type="date" value={healthExpire} onChange={(ev) => setHealthExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>

        <label className="flex items-center gap-3 py-1">
          <input type="checkbox" checked={sofortDone} onChange={(ev) => setSofortDone(ev.target.checked)} className="w-5 h-5 accent-green-600" />
          <span className="text-[var(--fs-sm)] font-medium text-gray-700">Sofortmeldung submitted</span>
        </label>
      </div>

      <div className="px-5 pt-2 pb-8 flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleSave} disabled={saving} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save & finish'}
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
