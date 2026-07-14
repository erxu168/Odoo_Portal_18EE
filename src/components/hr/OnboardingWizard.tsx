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
  const [contractSigned, setContractSigned] = useState(false);

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

  const loadContractStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/contract-status');
      if (res.ok) {
        const data = await res.json();
        // Contract is considered signed if state is 'open' (running) or 'close' (expired but was signed)
        if (data.contract && (data.contract.state === 'open' || data.contract.state === 'close')) {
          setContractSigned(true);
        }
      }
    } catch (_e: unknown) {
      console.error('Failed to load contract status');
    }
  }, []);

  useEffect(() => {
    loadEmployee();
    loadContractStatus();
  }, [loadEmployee, loadContractStatus]);

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
      {step === 7 && (
        contractSigned ? (
          <StepConsents employee={employee} onNext={onDone} onPrev={handlePrev} />
        ) : (
          <div className="p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Step locked</h3>
            <p className="text-sm text-gray-500 mb-6">
              Complete after contract signing. This step will become available once your employment contract has been signed and processed.
            </p>
            <button
              onClick={handlePrev}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50"
            >
              Back to review
            </button>
          </div>
        )
      )}
    </div>
  );
}
