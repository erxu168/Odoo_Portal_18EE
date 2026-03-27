'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onEdit: () => void;
}

export default function MyProfile({ onBack, onEdit }: Props) {
  const [emp, setEmp] = useState<EmployeeData | null>(null);
  const [iban, setIban] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoLoaded, setPhotoLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/hr/employee').then(r => r.json()).then(d => d.employee || null),
      fetch('/api/hr/bank').then(r => r.json()).then(d => d.iban || null).catch(() => null),
    ]).then(([employee, bankIban]) => {
      setEmp(employee);
      setIban(bankIban);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="My Profile" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="My Profile" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Could not load profile.</div>
      </div>
    );
  }

  const pct = calculateOnboardingPercent(emp);
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const dept = emp.department_id ? (emp.department_id as [number, string])[1] : 'No department';
  const job = emp.job_title || '';
  const isComplete = emp.kw_onboarding_status === 'complete';
  const m2oName = (v: any) => (v && Array.isArray(v) ? v[1] : '');

  const TAX_CLASSES: Record<string, string> = { '1': 'Class 1', '2': 'Class 2', '3': 'Class 3', '4': 'Class 4', '5': 'Class 5', '6': 'Class 6' };
  const KV_TYPES: Record<string, string> = { gesetzlich: 'Gesetzlich (public)', privat: 'Privat (private)', familienversicherung: 'Family insurance' };
  const KONFESSION: Record<string, string> = { ev: 'Evangelisch', rk: 'Katholisch', none: 'No church tax', other: 'Other' };

  function maskIban(raw: string): string {
    const c = raw.replace(/\s+/g, '');
    if (c.length <= 8) return c.replace(/(.{4})/g, '$1 ').trim();
    return (c.slice(0, 4) + c.slice(4, -4).replace(/./g, '\u2022') + c.slice(-4)).replace(/(.{4})/g, '$1 ').trim();
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <AppHeader title="My Profile" showBack onBack={onBack} />

      {/* Header card */}
      <div className="bg-white px-5 py-6 text-center border-b border-gray-200">
        <div className="w-[80px] h-[80px] rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[26px] mx-auto mb-3 overflow-hidden border-3 border-green-100">
          {photoLoaded ? (
            <img src="/api/hr/employee/photo" alt="" className="w-full h-full object-cover" />
          ) : initials}
          <img src="/api/hr/employee/photo" alt="" className="hidden" onLoad={() => setPhotoLoaded(true)} onError={() => setPhotoLoaded(false)} />
        </div>
        <div className="text-[20px] font-bold">{emp.name}</div>
        <div className="text-[14px] text-gray-500">{job ? `${job} \u00b7 ${dept}` : dept}</div>
        <div className="flex gap-2 justify-center mt-2.5">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700">Onboarding complete</span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">{pct}% complete</span>
          )}
        </div>
      </div>

      {/* Personal */}
      <SectionTitle text="Personal" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Birthday" value={emp.birthday || ''} mono />
        <Row label="Birth name" value={(emp as any).kw_geburtsname || ''} />
        <Row label="Gender" value={emp.gender || ''} />
        <Row label="Place of birth" value={emp.place_of_birth || ''} />
        <Row label="Country of birth" value={m2oName(emp.country_of_birth)} />
        <Row label="Nationality" value={m2oName(emp.country_id)} />
        <Row label="Marital status" value={emp.marital || ''} />
      </div>

      {/* Address */}
      <SectionTitle text="Address" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Street" value={emp.private_street || ''} />
        <Row label="Postcode" value={emp.private_zip || ''} mono />
        <Row label="City" value={emp.private_city || ''} />
        <Row label="Country" value={m2oName((emp as any).private_country_id)} />
      </div>

      {/* Contact */}
      <SectionTitle text="Contact" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Phone" value={emp.private_phone || ''} mono />
        <Row label="Email" value={emp.private_email || ''} />
        <Row label="Work email" value={emp.work_email || ''} />
      </div>

      {/* Emergency contact */}
      <SectionTitle text="Emergency contact" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Name" value={emp.emergency_contact || ''} />
        <Row label="Phone" value={emp.emergency_phone || ''} mono />
      </div>

      {/* Bank */}
      <SectionTitle text="Bank account" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="IBAN" value={iban ? maskIban(iban) : ''} mono />
      </div>

      {/* Tax */}
      <SectionTitle text="Tax" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Tax ID" value={(emp as any).kw_steuer_id || ''} mono />
        <Row label="Tax class" value={(emp as any).kw_steuerklasse ? TAX_CLASSES[(emp as any).kw_steuerklasse] || 'Class ' + (emp as any).kw_steuerklasse : ''} />
        <Row label="Konfession" value={(emp as any).kw_konfession ? KONFESSION[(emp as any).kw_konfession] || (emp as any).kw_konfession : ''} />
        <Row label="Kinderfreibetrag" value={(emp as any).kw_kinderfreibetrag ? String((emp as any).kw_kinderfreibetrag) : ''} />
      </div>

      {/* Insurance */}
      <SectionTitle text="Insurance" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="SV-Nr." value={emp.ssnid || ''} mono />
        <Row label="Krankenkasse" value={(emp as any).kw_krankenkasse_name || ''} />
        <Row label="Insurance type" value={(emp as any).kw_kv_typ ? KV_TYPES[(emp as any).kw_kv_typ] || (emp as any).kw_kv_typ : ''} />
      </div>

      {/* Employment */}
      <SectionTitle text="Employment" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Start date" value={(emp as any).kw_beschaeftigungsbeginn || ''} mono />
        <Row label="Weekly hours" value={(emp as any).kw_wochenarbeitszeit ? String((emp as any).kw_wochenarbeitszeit) + 'h' : ''} />
        <Row label="Fixed-term until" value={(emp as any).kw_befristung_bis || ''} mono />
        <Row label="Probation until" value={(emp as any).kw_probezeit_bis || ''} mono />
      </div>

      {/* Work permit */}
      <SectionTitle text="Work permit & ID" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="ID number" value={(emp as any).identification_id || ''} mono />
        <Row label="Passport" value={(emp as any).passport_id || ''} mono />
        <Row label="Permit type" value={(emp as any).kw_aufenthaltstitel_typ || ''} />
        <Row label="Visa expires" value={emp.visa_expire || ''} mono />
        <Row label="Work permit expires" value={(emp as any).work_permit_expiration_date || ''} mono />
      </div>

      {/* Health */}
      <SectionTitle text="Health certificate" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Issued" value={(emp as any).kw_gesundheitszeugnis_datum || ''} mono />
        <Row label="Expires" value={(emp as any).kw_gesundheitszeugnis_ablauf || ''} mono />
      </div>

      {/* Edit button */}
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        <button onClick={onEdit} className="w-full py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">
          Edit my information
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <div className="px-5 pt-4 pb-1 text-[11px] font-bold tracking-widest uppercase text-gray-400">{text}</div>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={'text-[13px] font-medium text-right max-w-[55%] ' + (mono ? 'font-mono ' : '') + (missing ? 'text-red-500 italic' : '')}>
        {missing ? 'Not provided' : value}
      </span>
    </div>
  );
}
