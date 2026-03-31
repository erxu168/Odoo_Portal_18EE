'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onEdit: () => void;
}

// Field types determine which editor to render
type FieldType = 'text' | 'date' | 'select' | 'country' | 'readonly';

interface FieldConfig {
  label: string;
  key: string;
  type: FieldType;
  mono?: boolean;
  options?: { value: string; label: string }[];
  display?: (emp: EmployeeData) => string;
  serialize?: (value: string) => unknown;
}

const GENDER_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const MARITAL_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widower', label: 'Widowed' },
  { value: 'cohabitant', label: 'Registered partner' },
];

const TAX_CLASS_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: '1', label: 'I - Single / Divorced / Widowed' },
  { value: '2', label: 'II - Single parent' },
  { value: '3', label: 'III - Married (partner in Class V)' },
  { value: '4', label: 'IV - Married (both Class IV)' },
  { value: '5', label: 'V - Married (partner in Class III)' },
  { value: '6', label: 'VI - Second job' },
];

const KONFESSION_OPTIONS = [
  { value: '--', label: 'None (no church tax)' },
  { value: 'ev', label: 'Protestant (Evangelisch)' },
  { value: 'rk', label: 'Roman Catholic (Katholisch)' },
  { value: 'ak', label: 'Old Catholic (Altkatholisch)' },
  { value: 'jd', label: 'Jewish (Jüdisch)' },
];

const KINDER_OPTIONS = [
  { value: '0', label: '0 — No children' },
  { value: '0.5', label: '0.5 — 1 child (shared)' },
  { value: '1', label: '1.0 — 1 child (full)' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: '2.0 — 2 children (full)' },
  { value: '2.5', label: '2.5' },
  { value: '3', label: '3.0 — 3 children (full)' },
  { value: '3.5', label: '3.5' },
  { value: '4', label: '4.0 — 4 children (full)' },
  { value: '4.5', label: '4.5' },
  { value: '5', label: '5.0 — 5 children (full)' },
];

const KV_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'gesetzlich', label: 'Gesetzlich (GKV)' },
  { value: 'privat', label: 'Privat (PKV)' },
  { value: 'geringfuegig', label: 'Geringfügig (Minijob)' },
];

const RELATION_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'spouse', label: 'Spouse / Partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'child', label: 'Child' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

const TAX_CLASSES: Record<string, string> = { '1': 'Class I', '2': 'Class II', '3': 'Class III', '4': 'Class IV', '5': 'Class V', '6': 'Class VI' };
const KV_TYPES: Record<string, string> = { gesetzlich: 'Gesetzlich (public)', privat: 'Privat (private)', geringfuegig: 'Geringfügig (Minijob)' };
const KONFESSION_LABELS: Record<string, string> = { ev: 'Evangelisch', rk: 'Katholisch', ak: 'Altkatholisch', jd: 'Jüdisch', '--': 'None' };
const RELATION_LABELS: Record<string, string> = { spouse: 'Spouse / Partner', parent: 'Parent', sibling: 'Sibling', child: 'Child', friend: 'Friend', other: 'Other' };

function m2oName(v: unknown): string {
  return v && Array.isArray(v) ? v[1] : '';
}

function m2oId(v: unknown): number {
  return v && Array.isArray(v) ? v[0] : 0;
}

function getFieldValue(emp: EmployeeData, key: string): string {
  const val = (emp as any)[key];
  if (val === false || val === null || val === undefined) return '';
  if (Array.isArray(val)) return val[1]; // M2O
  return String(val);
}

export default function MyProfile({ onBack, onEdit }: Props) {
  const [emp, setEmp] = useState<EmployeeData | null>(null);
  const [iban, setIban] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Country autocomplete state
  const [countrySuggestions, setCountrySuggestions] = useState<{ id: number; name: string }[]>([]);
  const [selectedCountryId, setSelectedCountryId] = useState(0);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  function loadProfile() {
    Promise.all([
      fetch('/api/hr/employee').then(r => r.json()).then(d => d.employee || null),
      fetch('/api/hr/bank').then(r => r.json()).then(d => d.iban || null).catch(() => null),
    ]).then(([employee, bankIban]) => {
      setEmp(employee);
      setIban(bankIban);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }

  function startEdit(key: string, currentValue: string, countryId?: number) {
    setEditingField(key);
    setEditValue(currentValue);
    setCountrySuggestions([]);
    setSelectedCountryId(countryId || 0);
  }

  function cancelEdit() {
    setEditingField(null);
    setEditValue('');
    setCountrySuggestions([]);
    setSelectedCountryId(0);
  }

  async function saveField(key: string, value: unknown) {
    setSaving(true);
    try {
      const res = await fetch('/api/hr/employee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [key]: value || false } }),
      });
      if (res.ok) {
        // Reload profile to get fresh data
        const empRes = await fetch('/api/hr/employee');
        if (empRes.ok) {
          const data = await empRes.json();
          if (data.employee) setEmp(data.employee);
        }
        showToast('Saved');
      } else {
        showToast('Failed to save');
      }
    } catch {
      showToast('Failed to save');
    } finally {
      setSaving(false);
      cancelEdit();
    }
  }

  async function searchCountries(query: string) {
    setEditValue(query);
    setSelectedCountryId(0);
    if (query.length < 2) { setCountrySuggestions([]); return; }
    try {
      const res = await fetch('/api/hr/employee?search_countries=' + encodeURIComponent(query));
      if (res.ok) {
        const data = await res.json();
        if (data.countries) setCountrySuggestions(data.countries);
      }
    } catch { setCountrySuggestions([]); }
  }

  function selectCountry(id: number, name: string) {
    setEditValue(name);
    setSelectedCountryId(id);
    setCountrySuggestions([]);
  }

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

  function maskIban(raw: string): string {
    const c = raw.replace(/\s+/g, '');
    if (c.length <= 8) return c.replace(/(.{4})/g, '$1 ').trim();
    return (c.slice(0, 4) + c.slice(4, -4).replace(/./g, '\u2022') + c.slice(-4)).replace(/(.{4})/g, '$1 ').trim();
  }

  // Render an editable row
  function EditableRow({ label, fieldKey, value, mono, type = 'text', options, countryId }: {
    label: string;
    fieldKey: string;
    value: string;
    mono?: boolean;
    type?: FieldType;
    options?: { value: string; label: string }[];
    countryId?: number;
  }) {
    const isEditing = editingField === fieldKey;
    const missing = !value;

    if (type === 'readonly') {
      return (
        <div className="flex justify-between py-2.5 border-b border-gray-50 last:border-b-0">
          <span className="text-[var(--fs-sm)] text-gray-500">{label}</span>
          <span className={'text-[var(--fs-sm)] font-medium text-right max-w-[55%] ' + (mono ? 'font-mono ' : '') + (missing ? 'text-red-500 italic' : '')}>
            {missing ? 'Not provided' : value}
          </span>
        </div>
      );
    }

    if (isEditing) {
      return (
        <div className="py-2.5 border-b border-gray-50 last:border-b-0">
          <div className="text-[var(--fs-xs)] font-semibold text-green-600 uppercase tracking-wide mb-1.5">{label}</div>

          {type === 'select' && options ? (
            <select
              className="form-input text-[var(--fs-md)]"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              autoFocus
            >
              {options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : type === 'country' ? (
            <div className="relative">
              <input
                className="form-input text-[var(--fs-md)]"
                value={editValue}
                onChange={e => searchCountries(e.target.value)}
                placeholder="Start typing..."
                autoFocus
              />
              {countrySuggestions.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                  {countrySuggestions.map(c => (
                    <button key={c.id} onClick={() => selectCountry(c.id, c.name)}
                      className="w-full text-left px-3 py-2.5 text-[var(--fs-sm)] text-gray-900 active:bg-green-50 border-b border-gray-100 last:border-0">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : type === 'date' ? (
            <input
              className="form-input text-[var(--fs-md)] font-mono"
              type="date"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              autoFocus
            />
          ) : (
            <input
              className={'form-input text-[var(--fs-md)]' + (mono ? ' font-mono' : '')}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            />
          )}

          <div className="flex gap-2 mt-2">
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="flex-1 py-3.5 text-[var(--fs-sm)] font-bold text-gray-600 bg-gray-100 rounded-xl active:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3.5 text-[var(--fs-sm)] font-bold text-white bg-green-600 rounded-xl active:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      );
    }

    // Read-only row — tap to edit
    return (
      <button
        onClick={() => startEdit(fieldKey, type === 'country' ? (value || '') : getFieldValue(emp!, fieldKey), type === 'country' ? countryId : undefined)}
        className="w-full flex justify-between py-2.5 border-b border-gray-50 last:border-b-0 text-left active:bg-gray-50 transition-colors"
      >
        <span className="text-[var(--fs-sm)] text-gray-500">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={'text-[var(--fs-sm)] font-medium text-right max-w-[55%] ' + (mono ? 'font-mono ' : '') + (missing ? 'text-red-500 italic' : '')}>
            {missing ? 'Not provided' : value}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 flex-shrink-0">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </button>
    );

    function handleSave() {
      if (type === 'country') {
        saveField(fieldKey, selectedCountryId || false);
      } else if (type === 'select' && fieldKey === 'kw_kinderfreibetrag') {
        saveField(fieldKey, parseFloat(editValue) || 0);
      } else {
        saveField(fieldKey, editValue || false);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader title="My Profile" showBack onBack={onBack} />

      {/* Header card */}
      <div className="bg-white px-5 py-6 text-center border-b border-gray-200">
        <div className="w-[80px] h-[80px] rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[var(--fs-xxl)] mx-auto mb-3 overflow-hidden border-3 border-green-100">
          {photoLoaded ? (
            <img src="/api/hr/employee/photo" alt="" className="w-full h-full object-cover" />
          ) : initials}
          <img src="/api/hr/employee/photo" alt="" className="hidden" onLoad={() => setPhotoLoaded(true)} onError={() => setPhotoLoaded(false)} />
        </div>
        <div className="text-[var(--fs-xl)] font-bold">{emp.name}</div>
        <div className="text-[var(--fs-sm)] text-gray-500">{job ? `${job} \u00b7 ${dept}` : dept}</div>
        <div className="flex gap-2 justify-center mt-2.5">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-green-50 text-green-700">Onboarding complete</span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-amber-50 text-amber-700">{pct}% complete</span>
          )}
        </div>
        <div className="text-[var(--fs-xs)] text-gray-400 mt-2">Tap any field to edit</div>
      </div>

      {/* Personal */}
      <SectionTitle text="Personal" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Birthday" fieldKey="birthday" value={emp.birthday || ''} type="date" mono />
        <EditableRow label="Nickname" fieldKey="nick_name" value={(emp as any).nick_name || ''} />
        <EditableRow label="Birth name" fieldKey="kw_geburtsname" value={(emp as any).kw_geburtsname || ''} />
        <EditableRow label="Gender" fieldKey="gender" value={emp.gender || ''} type="select" options={GENDER_OPTIONS} />
        <EditableRow label="Place of birth" fieldKey="place_of_birth" value={emp.place_of_birth || ''} />
        <EditableRow label="Country of birth" fieldKey="country_of_birth" value={m2oName(emp.country_of_birth)} type="country" countryId={m2oId(emp.country_of_birth)} />
        <EditableRow label="Nationality" fieldKey="country_id" value={m2oName(emp.country_id)} type="country" countryId={m2oId(emp.country_id)} />
        <EditableRow label="Marital status" fieldKey="marital" value={emp.marital || ''} type="select" options={MARITAL_OPTIONS} />
      </div>

      {/* Address */}
      <SectionTitle text="Address" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Street" fieldKey="private_street" value={emp.private_street || ''} />
        <EditableRow label="Postcode" fieldKey="private_zip" value={emp.private_zip || ''} mono />
        <EditableRow label="City" fieldKey="private_city" value={emp.private_city || ''} />
        <EditableRow label="Country" fieldKey="private_country_id" value={m2oName(emp.private_country_id)} type="country" countryId={m2oId(emp.private_country_id)} />
      </div>

      {/* Contact */}
      <SectionTitle text="Contact" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Phone" fieldKey="private_phone" value={emp.private_phone || ''} mono />
        <EditableRow label="Email" fieldKey="private_email" value={emp.private_email || ''} />
        <EditableRow label="Work email" fieldKey="work_email" value={emp.work_email || ''} type="readonly" />
      </div>

      {/* Emergency contact */}
      <SectionTitle text="Emergency contact" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Name" fieldKey="emergency_contact" value={emp.emergency_contact || ''} />
        <EditableRow label="Phone" fieldKey="emergency_phone" value={emp.emergency_phone || ''} mono />
        <EditableRow label="Relationship" fieldKey="kw_emergency_relation" value={RELATION_LABELS[emp.kw_emergency_relation as string] || (emp.kw_emergency_relation || '')} type="select" options={RELATION_OPTIONS} />
      </div>

      {/* Bank */}
      <SectionTitle text="Bank account" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="IBAN" fieldKey="bank_account_id" value={iban ? maskIban(iban) : ''} type="readonly" mono />
      </div>

      {/* Tax */}
      <SectionTitle text="Tax" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Tax ID" fieldKey="kw_steuer_id" value={(emp as any).kw_steuer_id || ''} mono />
        <EditableRow label="Tax class" fieldKey="kw_steuerklasse" value={TAX_CLASSES[(emp as any).kw_steuerklasse] || ''} type="select" options={TAX_CLASS_OPTIONS} />
        <EditableRow label="Konfession" fieldKey="kw_konfession" value={KONFESSION_LABELS[(emp as any).kw_konfession] || ''} type="select" options={KONFESSION_OPTIONS} />
        <EditableRow label="Kinderfreibetrag" fieldKey="kw_kinderfreibetrag" value={String((emp as any).kw_kinderfreibetrag || 0)} type="select" options={KINDER_OPTIONS} />
      </div>

      {/* Insurance */}
      <SectionTitle text="Insurance" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="SV-Nr." fieldKey="ssnid" value={emp.ssnid || ''} mono />
        <EditableRow label="Krankenkasse" fieldKey="kw_krankenkasse_name" value={(emp as any).kw_krankenkasse_name || ''} />
        <EditableRow label="Insurance type" fieldKey="kw_kv_typ" value={KV_TYPES[(emp as any).kw_kv_typ] || ''} type="select" options={KV_OPTIONS} />
      </div>

      {/* Employment (read-only — managed by HR) */}
      <SectionTitle text="Employment" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="Start date" fieldKey="kw_beschaeftigungsbeginn" value={(emp as any).kw_beschaeftigungsbeginn || ''} type="readonly" mono />
        <EditableRow label="Weekly hours" fieldKey="kw_wochenarbeitszeit" value={(emp as any).kw_wochenarbeitszeit ? String((emp as any).kw_wochenarbeitszeit) + 'h' : ''} type="readonly" />
        <EditableRow label="Fixed-term until" fieldKey="kw_befristung_bis" value={(emp as any).kw_befristung_bis || ''} type="readonly" mono />
        <EditableRow label="Probation until" fieldKey="kw_probezeit_bis" value={(emp as any).kw_probezeit_bis || ''} type="readonly" mono />
      </div>

      {/* Work permit */}
      <SectionTitle text="Work permit & ID" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <EditableRow label="ID number" fieldKey="identification_id" value={(emp as any).identification_id || ''} mono />
        <EditableRow label="Passport" fieldKey="passport_id" value={(emp as any).passport_id || ''} mono />
        <EditableRow label="Permit type" fieldKey="kw_aufenthaltstitel_typ" value={(emp as any).kw_aufenthaltstitel_typ || ''} type="readonly" />
        <EditableRow label="Visa expires" fieldKey="visa_expire" value={emp.visa_expire || ''} type="date" mono />
        <EditableRow label="Work permit expires" fieldKey="work_permit_expiration_date" value={(emp as any).work_permit_expiration_date || ''} type="date" mono />
      </div>

      {/* Health */}
      <SectionTitle text="Health certificate" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200 mb-6">
        <EditableRow label="Issued" fieldKey="kw_gesundheitszeugnis_datum" value={(emp as any).kw_gesundheitszeugnis_datum || ''} type="date" mono />
        <EditableRow label="Expires" fieldKey="kw_gesundheitszeugnis_ablauf" value={(emp as any).kw_gesundheitszeugnis_ablauf || ''} type="date" mono />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-[var(--fs-sm)] font-semibold px-4 py-2.5 rounded-full shadow-lg animate-[fadeIn_200ms_ease]">
          {toast}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <div className="px-5 pt-4 pb-1 text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">{text}</div>;
}
