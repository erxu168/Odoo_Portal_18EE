'use client';

import React, { useState, useCallback, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ProgressBar from '@/components/hr/ProgressBar';
import StepPersonal from '@/components/hr/StepPersonal';
import StepTax from '@/components/hr/StepTax';
import StepInsurance from '@/components/hr/StepInsurance';
import StepBank from '@/components/hr/StepBank';
import StepResidenceWork from '@/components/hr/StepResidenceWork';
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
        <StepResidenceWork
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
