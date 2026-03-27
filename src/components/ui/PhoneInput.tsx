'use client';

import React, { useState, useRef, useEffect } from 'react';

interface Country {
  code: string;
  dial: string;
  flag: string;
  name: string;
}

const COUNTRIES: Country[] = [
  { code: 'DE', dial: '49', flag: '\uD83C\uDDE9\uD83C\uDDEA', name: 'Germany' },
  { code: 'AT', dial: '43', flag: '\uD83C\uDDE6\uD83C\uDDF9', name: 'Austria' },
  { code: 'CH', dial: '41', flag: '\uD83C\uDDE8\uD83C\uDDED', name: 'Switzerland' },
  { code: 'PL', dial: '48', flag: '\uD83C\uDDF5\uD83C\uDDF1', name: 'Poland' },
  { code: 'TR', dial: '90', flag: '\uD83C\uDDF9\uD83C\uDDF7', name: 'Turkey' },
  { code: 'RO', dial: '40', flag: '\uD83C\uDDF7\uD83C\uDDF4', name: 'Romania' },
  { code: 'IT', dial: '39', flag: '\uD83C\uDDEE\uD83C\uDDF9', name: 'Italy' },
  { code: 'ES', dial: '34', flag: '\uD83C\uDDEA\uD83C\uDDF8', name: 'Spain' },
  { code: 'FR', dial: '33', flag: '\uD83C\uDDEB\uD83C\uDDF7', name: 'France' },
  { code: 'GB', dial: '44', flag: '\uD83C\uDDEC\uD83C\uDDE7', name: 'United Kingdom' },
  { code: 'US', dial: '1', flag: '\uD83C\uDDFA\uD83C\uDDF8', name: 'United States' },
  { code: 'IN', dial: '91', flag: '\uD83C\uDDEE\uD83C\uDDF3', name: 'India' },
  { code: 'KR', dial: '82', flag: '\uD83C\uDDF0\uD83C\uDDF7', name: 'South Korea' },
  { code: 'JP', dial: '81', flag: '\uD83C\uDDEF\uD83C\uDDF5', name: 'Japan' },
  { code: 'CN', dial: '86', flag: '\uD83C\uDDE8\uD83C\uDDF3', name: 'China' },
  { code: 'VN', dial: '84', flag: '\uD83C\uDDFB\uD83C\uDDF3', name: 'Vietnam' },
  { code: 'PH', dial: '63', flag: '\uD83C\uDDF5\uD83C\uDDED', name: 'Philippines' },
  { code: 'UA', dial: '380', flag: '\uD83C\uDDFA\uD83C\uDDE6', name: 'Ukraine' },
  { code: 'RU', dial: '7', flag: '\uD83C\uDDF7\uD83C\uDDFA', name: 'Russia' },
  { code: 'BR', dial: '55', flag: '\uD83C\uDDE7\uD83C\uDDF7', name: 'Brazil' },
];

function formatNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return digits.slice(0, 4) + '-' + digits.slice(4, 8);
}

function parseExisting(value: string): { countryIdx: number; area: string; number: string } {
  if (!value) return { countryIdx: 0, area: '', number: '' };

  const cleaned = value.replace(/[\s\-()]/g, '');

  // Try to match +XX or +XXX country code
  if (cleaned.startsWith('+')) {
    const withoutPlus = cleaned.slice(1);
    // Try longest dial code first (3 digits, then 2, then 1)
    for (const len of [3, 2, 1]) {
      const dialCandidate = withoutPlus.slice(0, len);
      const idx = COUNTRIES.findIndex(c => c.dial === dialCandidate);
      if (idx >= 0) {
        const rest = withoutPlus.slice(len);
        // Split rest into area (2-4 digits) and number
        if (rest.length >= 6) {
          const area = rest.slice(0, 3);
          const num = rest.slice(3);
          return { countryIdx: idx, area, number: num };
        }
        return { countryIdx: idx, area: rest, number: '' };
      }
    }
  }

  // Try 0-prefixed (German domestic)
  if (cleaned.startsWith('0')) {
    const area = cleaned.slice(1, 4);
    const num = cleaned.slice(4);
    return { countryIdx: 0, area, number: num };
  }

  return { countryIdx: 0, area: '', number: cleaned };
}

interface Props {
  value: string;
  onChange: (fullNumber: string) => void;
  placeholder?: string;
}

export default function PhoneInput({ value, onChange }: Props) {
  const parsed = parseExisting(value);
  const [countryIdx, setCountryIdx] = useState(parsed.countryIdx);
  const [area, setArea] = useState(parsed.area);
  const [number, setNumber] = useState(parsed.number);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const country = COUNTRIES[countryIdx];

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  function emitChange(cIdx: number, a: string, n: string) {
    const c = COUNTRIES[cIdx];
    const cleanArea = a.replace(/\D/g, '');
    const cleanNum = n.replace(/\D/g, '');
    if (!cleanArea && !cleanNum) {
      onChange('');
      return;
    }
    onChange('+' + c.dial + ' ' + cleanArea + ' ' + cleanNum.slice(0, 4) + (cleanNum.length > 4 ? '-' + cleanNum.slice(4) : ''));
  }

  function handleAreaChange(val: string) {
    let digits = val.replace(/\D/g, '');
    // Strip leading 0 (domestic prefix)
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length > 4) digits = digits.slice(0, 4);
    setArea(digits);
    emitChange(countryIdx, digits, number);
  }

  function handleNumberChange(val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 8);
    setNumber(digits);
    emitChange(countryIdx, area, digits);
  }

  function selectCountry(idx: number) {
    setCountryIdx(idx);
    setDropdownOpen(false);
    emitChange(idx, area, number);
  }

  return (
    <div className="flex items-stretch gap-1.5">
      {/* Country selector */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="h-full px-2.5 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-1 text-[14px] active:bg-gray-100 transition-colors min-w-[80px] flex-shrink-0"
        >
          <span className="text-[18px] leading-none">{country.flag}</span>
          <span className="text-[13px] font-mono font-semibold text-gray-700">+{country.dial}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ml-0.5 ${dropdownOpen ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute z-20 left-0 top-full mt-1 w-[220px] bg-white border border-gray-200 rounded-xl shadow-lg max-h-[250px] overflow-y-auto">
            {COUNTRIES.map((c, idx) => (
              <button
                key={c.code}
                onClick={() => selectCountry(idx)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] active:bg-gray-50 border-b border-gray-50 last:border-0 ${idx === countryIdx ? 'bg-green-50 font-semibold' : ''}`}
              >
                <span className="text-[16px]">{c.flag}</span>
                <span className="flex-1 text-gray-900">{c.name}</span>
                <span className="text-[12px] font-mono text-gray-400">+{c.dial}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Area code */}
      <input
        type="tel"
        value={area}
        onChange={e => handleAreaChange(e.target.value)}
        placeholder="176"
        className="form-input font-mono w-[60px] min-w-[60px] max-w-[60px] text-center text-[14px] flex-shrink-0"
        maxLength={5}
      />

      {/* Number */}
      <input
        type="tel"
        value={formatNumber(number)}
        onChange={e => handleNumberChange(e.target.value)}
        placeholder="1035-6597"
        className="form-input font-mono flex-1 min-w-0 text-[14px]"
        maxLength={9}
      />
    </div>
  );
}
