'use client';

import React, { useState } from 'react';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  onPrev: () => void;
  onSubmit: () => void;
  saving: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
}

export default function StepReview({ employee, onPrev, onSubmit, saving, onSave }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const pct = calculateOnboardingPercent(employee);

  async function handleSubmit() {
    setSubmitting(true);
    await onSave({ kw_onboarding_status: 'data_complete' });
    setSubmitting(false);
    onSubmit();
  }

  return (
    <div className="pb-40">
      <div className="p-5">
        <p className="text-[13px] text-gray-500 mb-4">
          Please review your information. After submitting, your manager will review and approve your data.
        </p>

        <Section title={'\u{1F464} Personal'}>
          <Row label="Name" value={employee.name} />
          <Row label="Birthday" value={employee.birthday || ''} mono />
          <Row label="Gender" value={employee.gender || ''} />
          <Row label="Marital" value={employee.marital || ''} />
          <Row label="Address" value={formatAddr(employee)} />
          <Row label="Phone" value={employee.private_phone || ''} mono />
          <Row label="Emergency" value={employee.emergency_contact || ''} />
        </Section>

        <Section title={'\u{1F3E6} Bank'}>
          <Row label="IBAN" value={employee.bank_account_id ? 'On file' : ''} />
        </Section>

        <Section title={'\u{1F4B0} Tax'}>
          <Row label="Tax ID" value={employee.kw_steuer_id || ''} mono />
          <Row label="Tax class" value={employee.kw_steuerklasse ? `Class ${employee.kw_steuerklasse}` : ''} />
          <Row label="Church tax" value={employee.kw_konfession === '--' ? 'None' : employee.kw_konfession || ''} />
        </Section>

        <Section title={'\u{1F3E5} Insurance'}>
          <Row label="SV-Nr." value={employee.ssnid || ''} mono />
          <Row label="Krankenkasse" value={employee.kw_krankenkasse_name || ''} />
        </Section>

        <Section title={'\u{1F4C4} Documents'}>
          <DocRow label="ID / Passport" ok={employee.kw_doc_ausweis_ok} />
          <DocRow label="Tax ID Letter" ok={employee.kw_doc_steuer_id_ok} />
          <DocRow label="SV Card" ok={employee.kw_doc_sv_ausweis_ok} />
          <DocRow label="Health Cert." ok={employee.kw_doc_gesundheitszeugnis_ok} />
          <DocRow label="Contract" ok={employee.kw_doc_vertrag_ok} />
        </Section>

        {pct < 100 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4 text-[13px] text-amber-800 flex items-start gap-2">
            <span className="text-lg leading-none">!</span>
            <div>Some fields are missing ({pct}% complete). You can still submit now and complete them later.</div>
          </div>
        )}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleSubmit} disabled={saving || submitting} className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
          {submitting ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

function formatAddr(e: EmployeeData): string {
  const parts = [e.private_street, e.private_zip, e.private_city].filter(Boolean);
  return parts.join(', ') || '';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
      <div className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={`text-[13px] font-medium text-right max-w-[55%] ${mono ? 'font-mono' : ''} ${missing ? 'text-red-500 italic' : ''}`}>
        {missing ? 'Not provided' : value}
      </span>
    </div>
  );
}

function DocRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={`text-[13px] font-semibold ${ok ? 'text-green-600' : 'text-red-500 italic'}`}>
        {ok ? '\u2713 Uploaded' : 'Missing'}
      </span>
    </div>
  );
}
