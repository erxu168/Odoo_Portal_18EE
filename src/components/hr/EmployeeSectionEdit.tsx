'use client';

import React, { useState, useCallback, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import StepPersonal from '@/components/hr/StepPersonal';
import StepTax from '@/components/hr/StepTax';
import StepInsurance from '@/components/hr/StepInsurance';
import StepBank from '@/components/hr/StepBank';
import StepResidenceWork from '@/components/hr/StepResidenceWork';
import type { EmployeeData } from '@/types/hr';

export type SectionKey = 'personal' | 'tax' | 'insurance' | 'bank' | 'residence';

const SECTION_TITLES: Record<SectionKey, string> = {
  personal: 'Personal & address',
  tax: 'Tax',
  insurance: 'Insurance',
  bank: 'Bank',
  residence: 'Residence & work',
};

interface Props {
  employeeId: number;
  section: SectionKey;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

/**
 * Manager section editor: loads one employee and shows a single editable section,
 * reusing the onboarding step components. Saves just that section via the
 * company-scoped /api/hr/employee/[id] (and /api/hr/bank via StepBank itself),
 * then returns to the detail screen. No wizard, no consents.
 */
export default function EmployeeSectionEdit({ employeeId, section, onBack, onDone }: Props) {
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

  // Save the given DATEV fields, then return to the detail screen.
  async function saveAndDone(fields: Record<string, unknown>) {
    if (!fields || Object.keys(fields).length === 0) { onDone(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save.'); setSaving(false); return; }
      onDone();
    } catch {
      setError('Could not save.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title={SECTION_TITLES[section]} showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title={SECTION_TITLES[section]} showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">{error || 'Could not load this employee.'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={SECTION_TITLES[section]} subtitle={employee.name} showBack onBack={onBack} />

      {section === 'personal' && (
        <StepPersonal employee={employee} onNext={saveAndDone} saving={saving} submitLabel="Save" />
      )}
      {section === 'tax' && (
        <StepTax employee={employee} onNext={saveAndDone} onPrev={onBack} saving={saving} submitLabel="Save" />
      )}
      {section === 'insurance' && (
        <StepInsurance employee={employee} onNext={saveAndDone} onPrev={onBack} saving={saving} submitLabel="Save" requireAck={false} />
      )}
      {section === 'bank' && (
        <StepBank employee={employee} employeeId={employeeId} onNext={() => onDone()} onPrev={onBack} saving={saving} submitLabel="Save" />
      )}
      {section === 'residence' && (
        <StepResidenceWork employee={employee} saving={saving} onPrev={onBack} onSave={saveAndDone} submitLabel="Save" />
      )}

      {error && (
        <div className="mx-5 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
      )}
    </div>
  );
}
