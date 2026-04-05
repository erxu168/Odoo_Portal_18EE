'use client';

import React, { useState } from 'react';
import type { EmployeeData } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  onNext: () => void;
  onPrev: () => void;
}

interface ConsentItem {
  key: string;
  title: string;
  text: string;
  legalRef?: string;
}

const CONSENTS: ConsentItem[] = [
  {
    key: 'legalDocs',
    title: 'Legal document requirements',
    text: 'I understand that I am required by German law to carry valid identification documents at all times while working. This includes my ID card or passport, work permit (if applicable), and Rote Karte (Gesundheitszeugnis). Failure to present these documents during an inspection may result in fines for myself and my employer.',
  },
  {
    key: 'dataProtection',
    title: 'Data protection notice (DSGVO / GDPR)',
    text: 'I acknowledge that my personal data (name, address, date of birth, tax ID, social security number, bank details, and employment-related information) is processed by my employer for the purpose of administering the employment relationship, payroll, and tax/social security compliance. This processing is based on Section 26 BDSG and Art. 6(1)(b)(c) GDPR.',
    legalRef: 'Art. 13/14 GDPR, \u00a726 BDSG',
  },
  {
    key: 'digitalStorage',
    title: 'Consent to digital document storage',
    text: 'I consent to the digital storage of copies of my personal documents (ID, tax certificate, social security card, health certificate, and other uploaded documents) in a secure, access-restricted electronic personnel file system.',
    legalRef: 'Art. 6(1)(a) GDPR, \u00a720(2) PAuswG',
  },
  {
    key: 'ifsg',
    title: 'Infection protection obligations (IfSG \u00a743)',
    text: 'I confirm that I hold a valid health certificate (Rote Karte / Gesundheitszeugnis). I understand that I am legally prohibited from working with food if I am suffering from or suspect any condition listed in \u00a742 IfSG. I am obligated to immediately inform my employer if any such condition arises.',
    legalRef: '\u00a743 Infektionsschutzgesetz (IfSG)',
  },
  {
    key: 'photoConsent',
    title: 'Profile photo consent',
    text: 'I voluntarily consent to my employer using my profile photo for internal purposes including my employee profile, scheduling systems, and internal communications. I may withdraw this consent at any time in writing.',
    legalRef: 'Art. 6(1)(a) GDPR, \u00a722 KunstUrhG',
  },
  {
    key: 'confidentiality',
    title: 'Confidentiality obligation',
    text: 'I agree to maintain confidentiality regarding all business and trade secrets that become known to me during my employment. This includes but is not limited to: recipes, supplier information, pricing, customer data, and internal processes.',
    legalRef: '\u00a7241(2) BGB, GeschGehG',
  },
];

function getStorageKey(empId: number): string {
  return `kw_consents_${empId}`;
}

function loadSavedConsents(empId: number): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(getStorageKey(empId));
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  const init: Record<string, boolean> = {};
  CONSENTS.forEach(c => (init[c.key] = false));
  return init;
}

export default function StepConsents({ employee, onNext, onPrev }: Props) {
  const empId = employee.id || 0;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const saved = loadSavedConsents(empId);
    const init: Record<string, boolean> = {};
    CONSENTS.forEach(c => (init[c.key] = saved[c.key] || false));
    return init;
  });

  function toggle(key: string) {
    setChecked(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(getStorageKey(empId), JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }

  const allChecked = CONSENTS.every(c => checked[c.key]);
  const checkedCount = CONSENTS.filter(c => checked[c.key]).length;

  return (
    <div className="pb-8">
      <div className="p-5">
        <p className="text-[var(--fs-sm)] text-gray-500 mb-1">
          Please read and acknowledge each item below before submitting your onboarding. All acknowledgments are required.
        </p>
        <p className="text-[var(--fs-xs)] text-gray-400 mb-4">
          {checkedCount} of {CONSENTS.length} acknowledged
        </p>

        {CONSENTS.map(consent => (
          <button
            key={consent.key}
            onClick={() => toggle(consent.key)}
            className="w-full flex items-start gap-3 p-4 rounded-2xl border border-gray-200 bg-white text-left active:bg-gray-50 mb-2.5"
          >
            <div className={'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ' +
              (checked[consent.key] ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white')}>
              {checked[consent.key] && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              )}
            </div>
            <div className="flex-1">
              <div className="text-[var(--fs-sm)] font-semibold text-gray-900 leading-snug">{consent.title}</div>
              <p className="text-[var(--fs-xs)] text-gray-500 leading-relaxed mt-1">{consent.text}</p>
              {consent.legalRef && (
                <p className="text-[10px] text-gray-400 mt-1 font-mono">{consent.legalRef}</p>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="px-5 pt-4 pb-8 flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={onNext} disabled={!allChecked} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          Submit for Review
        </button>
      </div>
    </div>
  );
}
