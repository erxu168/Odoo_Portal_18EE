'use client';

import React, { useState } from 'react';
import type { EmployeeData } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  saving: boolean;
  onPrev: () => void;
  onSave: (fields: Record<string, unknown>) => void;
  submitLabel?: string;
}

// Valid keys for the Odoo Selection field hr.employee.kw_aufenthaltstitel_typ.
// Must match Odoo exactly — a free-text value (e.g. "§ 16b Abs. 3 AufenthG") is
// rejected server-side with "Wrong value for ...". Labels mirror Odoo's German
// wording with an English gloss, matching the other onboarding selects.
const PERMIT_TYPES: { value: string; label: string }[] = [
  { value: 'unbefristet', label: 'Permanent settlement permit (Niederlassungserlaubnis)' },
  { value: 'befristet', label: 'Temporary residence permit (Aufenthaltserlaubnis)' },
  { value: 'blau', label: 'EU Blue Card (Blaue Karte EU)' },
  { value: 'icr', label: 'ICT Card (ICT-Karte)' },
  { value: 'duldung', label: 'Toleration (Duldung)' },
  { value: 'gestattung', label: 'Permission to stay (Aufenthaltsgestattung)' },
  { value: 'visum', label: 'Visa (Visum)' },
  { value: 'eu_buerger', label: 'EU/EEA citizen — no permit needed (EU/EWR-Bürger)' },
  { value: 'deutsch', label: 'German citizen (Deutsche Staatsangehörigkeit)' },
];

/**
 * Residence, work permit and health-certificate fields. Extracted from the old
 * EmployeeProfileEdit wizard so it can be reused as a standalone section editor.
 */
export default function StepResidenceWork({ employee, saving, onPrev, onSave, submitLabel = 'Save & finish' }: Props) {
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
  const [isStudent, setIsStudent] = useState(e.is_university_student === true);

  function handleSave() {
    onSave({
      is_university_student: isStudent,
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

        <label className="flex items-start gap-3 py-1">
          <input type="checkbox" checked={isStudent} onChange={(ev) => setIsStudent(ev.target.checked)} className="w-5 h-5 mt-0.5 accent-green-600 flex-shrink-0" />
          <span className="text-[var(--fs-sm)] font-medium text-gray-700">
            Working student (Werkstudent)
            <span className="block text-[var(--fs-xs)] text-gray-400 font-normal">Turns on the student documents (enrolment certificate, student ID) for this person.</span>
          </span>
        </label>

        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 pt-1">Residence / work permit</div>
        <Field label="Permit type">
          <select value={permitType} onChange={(ev) => setPermitType(ev.target.value)} className="form-inp">
            <option value="">Select type…</option>
            {PERMIT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="block text-[var(--fs-xs)] text-gray-400 mt-1.5">For a student permit (§ 16b AufenthG), choose Temporary residence permit.</span>
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
          {saving ? 'Saving…' : submitLabel}
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
