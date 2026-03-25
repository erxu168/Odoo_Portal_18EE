'use client';

import React, { useState, useRef, useEffect } from 'react';
import InfoButton from '@/components/hr/InfoButton';
import type { EmployeeData } from '@/types/hr';
import { FIELD_EXPLAINERS } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  saving: boolean;
}

interface AddressSuggestion {
  street: string;
  postcode: string;
  city: string;
  display: string;
}

const RELATIONSHIP_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'spouse', label: 'Spouse / Partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'child', label: 'Child' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

function formatPhone(raw: string): string {
  // Strip everything except digits and leading +
  let digits = raw.replace(/[^\d+]/g, '');
  // Ensure starts with +
  if (!digits.startsWith('+') && digits.length > 0) {
    if (digits.startsWith('00')) digits = '+' + digits.slice(2);
    else if (digits.startsWith('0')) digits = '+49' + digits.slice(1);
    else digits = '+' + digits;
  }
  // Format: +49 176 1234-5678
  const match = digits.match(/^(\+\d{1,3})(\d{2,4})(\d{4})(\d{1,4})?$/);
  if (match) {
    return [match[1], match[2], match[3] + (match[4] ? '-' + match[4] : '')].join(' ');
  }
  // Partial format: just group nicely
  if (digits.length > 3) {
    const cc = digits.slice(0, digits.startsWith('+49') ? 3 : digits.startsWith('+') ? (digits.length > 4 ? 3 : digits.length) : 3);
    const rest = digits.slice(cc.length);
    if (rest.length > 3) {
      return cc + ' ' + rest.slice(0, 3) + ' ' + rest.slice(3);
    }
    return cc + ' ' + rest;
  }
  return digits;
}

export default function StepPersonal({ employee, onNext, saving }: Props) {
  const [birthday, setBirthday] = useState(employee.birthday || '');
  const [gender, setGender] = useState(employee.gender || '');
  const [marital, setMarital] = useState(employee.marital || 'single');
  const [geburtsname, setGeburtsname] = useState(employee.kw_geburtsname || '');
  const [placeOfBirth, setPlaceOfBirth] = useState(employee.place_of_birth || '');

  // Country of birth (autocomplete against Odoo res.country)
  const [countryOfBirth, setCountryOfBirth] = useState(employee.country_of_birth ? (employee.country_of_birth as [number, string])[1] : '');
  const [countryOfBirthId, setCountryOfBirthId] = useState(employee.country_of_birth ? (employee.country_of_birth as [number, string])[0] : 0);
  const [countrySuggestions, setCountrySuggestions] = useState<{ id: number; name: string }[]>([]);

  // Address
  const [street, setStreet] = useState(employee.private_street || '');
  const [zip, setZip] = useState(employee.private_zip || '');
  const [city, setCity] = useState(employee.private_city || '');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const addressDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Contact
  const [phone, setPhone] = useState(employee.private_phone || '');
  const [email, setEmail] = useState(employee.private_email || '');

  // Emergency contact
  const [emergName, setEmergName] = useState(employee.emergency_contact || '');
  const [emergPhone, setEmergPhone] = useState(employee.emergency_phone || '');
  const [emergRelation, setEmergRelation] = useState((employee as any).kw_emergency_relation || '');

  function handleSubmit() {
    onNext({
      birthday: birthday || false,
      gender: gender || false,
      marital,
      kw_geburtsname: geburtsname || false,
      place_of_birth: placeOfBirth || false,
      country_of_birth: countryOfBirthId || false,
      private_street: street || false,
      private_zip: zip || false,
      private_city: city || false,
      private_phone: phone || false,
      private_email: email || false,
      emergency_contact: emergName || false,
      emergency_phone: emergPhone || false,
    });
  }

  // --- Country search ---
  async function searchCountries(query: string) {
    setCountryOfBirth(query);
    setCountryOfBirthId(0);
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
    setCountryOfBirth(name);
    setCountryOfBirthId(id);
    setCountrySuggestions([]);
  }

  // --- Address autocomplete ---
  function handleAddressInput(value: string) {
    setAddressQuery(value);
    setStreet(value);
    if (addressDebounce.current) clearTimeout(addressDebounce.current);
    if (value.length < 3) { setAddressSuggestions([]); return; }
    addressDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/address-autocomplete?q=' + encodeURIComponent(value));
        if (res.ok) {
          const data = await res.json();
          setAddressSuggestions(data.results || []);
        }
      } catch { setAddressSuggestions([]); }
    }, 350);
  }

  function selectAddress(addr: AddressSuggestion) {
    setStreet(addr.street);
    setZip(addr.postcode);
    setCity(addr.city);
    setAddressQuery(addr.street);
    setAddressSuggestions([]);
  }

  // --- Phone formatting ---
  function handlePhoneChange(value: string, setter: (v: string) => void) {
    setter(formatPhone(value));
  }

  const ex = FIELD_EXPLAINERS.kw_geburtsname;

  return (
    <div className="pb-40">
      <div className="p-5 space-y-4">
        <Field label="Full name">
          <input className="form-input" value={employee.name} disabled />
        </Field>
        <Field label="Birth name" labelDe="Geburtsname" info={ex}>
          <input className="form-input" value={geburtsname} onChange={e => setGeburtsname(e.target.value)} placeholder="Only if different from current name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of birth">
            <input className="form-input font-mono" type="date" value={birthday} onChange={e => setBirthday(e.target.value)} />
          </Field>
          <Field label="Gender">
            <select className="form-input" value={gender} onChange={e => setGender(e.target.value)}>
              <option value="">Select...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Place of birth" labelDe="Geburtsort">
          <input className="form-input" value={placeOfBirth} onChange={e => setPlaceOfBirth(e.target.value)} placeholder="City or region" />
        </Field>
        <Field label="Country of birth" labelDe="Geburtsland">
          <div className="relative">
            <input className="form-input" value={countryOfBirth} onChange={e => searchCountries(e.target.value)} placeholder="Start typing..." />
            {countrySuggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                {countrySuggestions.map(c => (
                  <button key={c.id} onClick={() => selectCountry(c.id, c.name)}
                    className="w-full text-left px-3 py-2.5 text-[13px] text-gray-900 active:bg-green-50 border-b border-gray-100 last:border-0">
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Marital status" labelDe="Familienstand">
          <select className="form-input" value={marital} onChange={e => setMarital(e.target.value as any)}>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widower">Widowed</option>
            <option value="cohabitant">Registered partner</option>
          </select>
        </Field>

        {/* Address with autocomplete */}
        <div className="text-[12px] font-bold tracking-wider uppercase text-gray-400 pt-2">Address</div>
        <Field label="Street & number" labelDe="Straße">
          <div className="relative">
            <input className="form-input" value={street} onChange={e => handleAddressInput(e.target.value)} placeholder="Start typing your address..." />
            {addressSuggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {addressSuggestions.map((addr, i) => (
                  <button key={i} onClick={() => selectAddress(addr)}
                    className="w-full text-left px-3 py-2.5 text-[13px] active:bg-green-50 border-b border-gray-100 last:border-0">
                    <div className="font-semibold text-gray-900">{addr.street}</div>
                    <div className="text-[11px] text-gray-500">{addr.postcode} {addr.city}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Postcode" labelDe="PLZ">
            <input className="form-input font-mono" value={zip} onChange={e => setZip(e.target.value)} placeholder="e.g. 10115" maxLength={5} />
          </Field>
          <Field label="City" labelDe="Stadt">
            <input className="form-input" value={city} onChange={e => setCity(e.target.value)} placeholder="Berlin" />
          </Field>
        </div>

        {/* Contact */}
        <Field label="Email">
          <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
        </Field>
        <Field label="Phone" labelDe="Telefon">
          <input className="form-input font-mono" type="tel" value={phone} onChange={e => handlePhoneChange(e.target.value, setPhone)} placeholder="+49 176 1234-5678" />
        </Field>

        {/* Emergency contact */}
        <div className="text-[12px] font-bold tracking-wider uppercase text-gray-400 pt-2">Emergency contact</div>
        <Field label="Contact name">
          <input className="form-input" value={emergName} onChange={e => setEmergName(e.target.value)} placeholder="e.g. Maria Schmidt" />
        </Field>
        <Field label="Relationship" labelDe="Beziehung">
          <select className="form-input" value={emergRelation} onChange={e => setEmergRelation(e.target.value)}>
            {RELATIONSHIP_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Contact phone">
          <input className="form-input font-mono" type="tel" value={emergPhone} onChange={e => handlePhoneChange(e.target.value, setEmergPhone)} placeholder="+49 176 1234-5678" />
        </Field>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent">
        <button onClick={handleSubmit} disabled={saving} className="w-full py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, labelDe, info, children }: { label: string; labelDe?: string; info?: { title: string; text: string; url?: string; urlLabel?: string }; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {labelDe && <span className="text-[12px] text-gray-400">({labelDe})</span>}
        {info && <InfoButton title={info.title} text={info.text} url={info.url} urlLabel={info.urlLabel} />}
      </div>
      {children}
    </div>
  );
}
