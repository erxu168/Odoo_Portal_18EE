'use client';

import React, { useEffect, useState, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ProgressBar from '@/components/hr/ProgressBar';
import StepPersonal from '@/components/hr/StepPersonal';
import StepBank from '@/components/hr/StepBank';
import StepTax from '@/components/hr/StepTax';
import StepInsurance from '@/components/hr/StepInsurance';
import StepDocuments from '@/components/hr/StepDocuments';
import StepConcurrentEmployment from '@/components/hr/StepConcurrentEmployment';
import StepConsents from '@/components/hr/StepConsents';
import StepReview from '@/components/hr/StepReview';
import type { EmployeeData } from '@/types/hr';

interface Props {
  initialStep?: number;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

const STEP_TITLES = [
  'Personal details',
  'Bank account',
  'Tax details',
  'Health & social insurance',
  'Upload documents',
  'Concurrent employment',
  'Review',
  'Acknowledgments & submit',
];

const TOTAL_STEPS = STEP_TITLES.length;

export default function OnboardingWizard({ initialStep, onBack, onDone }: Props) {
  const [step, setStep] = useState((initialStep || 1) - 1);
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadEmployee = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/employee');
      if (res.ok) {
        const data = await res.json();
        setEmployee(data.employee);
      }
    } catch (_e: unknown) {
      console.error('Failed to load employee');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployee();
  }, [loadEmployee]);

  async function saveFields(fields: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch('/api/hr/employee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        await loadEmployee();
      }
    } catch (_e: unknown) {
      console.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleNext(fields?: Record<string, unknown>) {
    if (fields && Object.keys(fields).length > 0) {
      saveFields(fields).then(() => {
        if (step < TOTAL_STEPS - 1) setStep(step + 1);
      });
    } else {
      if (step < TOTAL_STEPS - 1) setStep(step + 1);
    }
  }

  function handlePrev() {
    if (step > 0) setStep(step - 1);
    else onBack();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Onboarding" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Onboarding" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">
          Could not load your employee data.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title={STEP_TITLES[step]}
        showBack
        onBack={handlePrev}
      />
      <ProgressBar
        currentStep={step}
        totalSteps={TOTAL_STEPS}
        label={`Step ${step + 1} of ${TOTAL_STEPS} \u2014 ${STEP_TITLES[step]}`}
      />

      {step === 0 && <StepPersonal employee={employee} onNext={handleNext} saving={saving} />}
      {step === 1 && <StepBank employee={employee} onNext={handleNext} onPrev={handlePrev} saving={saving} />}
      {step === 2 && <StepTax employee={employee} onNext={handleNext} onPrev={handlePrev} saving={saving} />}
      {step === 3 && <StepInsurance employee={employee} onNext={handleNext} onPrev={handlePrev} saving={saving} />}
      {step === 4 && <StepDocuments employee={employee} onNext={() => setStep(5)} onPrev={handlePrev} onRefresh={loadEmployee} />}
      {step === 5 && <StepConcurrentEmployment onNext={() => setStep(6)} onPrev={handlePrev} />}
      {step === 6 && <StepReview employee={employee} onPrev={handlePrev} onSubmit={() => setStep(7)} saving={saving} onSave={saveFields} />}
      {step === 7 && <StepConsents onNext={onDone} onPrev={handlePrev} />}
    </div>
  );
}
