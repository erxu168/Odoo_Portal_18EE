'use client';

import React, { useState } from 'react';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

interface DateFilterProps {
  value: string; // preset key or 'custom'
  onChange: (preset: string, range: DateRange | null) => void;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getRange(preset: string): DateRange | null {
  const now = new Date();
  const today = localDate(now);
  const dow = now.getDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;

  switch (preset) {
    case 'today': {
      return { from: today, to: today };
    }
    case 'this_week': {
      const mon = new Date(now);
      mon.setDate(now.getDate() + mondayOffset);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { from: localDate(mon), to: localDate(sun) };
    }
    case 'last_week': {
      const mon = new Date(now);
      mon.setDate(now.getDate() + mondayOffset - 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { from: localDate(mon), to: localDate(sun) };
    }
    case 'this_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: localDate(first), to: localDate(last) };
    }
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: localDate(first), to: localDate(last) };
    }
    default:
      return null;
  }
}

const PRESETS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

export default function DateFilter({ value, onChange }: DateFilterProps) {
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  function handlePreset(key: string) {
    if (key === 'custom') {
      onChange('custom', customFrom && customTo ? { from: customFrom, to: customTo } : null);
    } else if (key === 'all') {
      onChange('all', null);
    } else {
      onChange(key, getRange(key));
    }
  }

  function handleCustomChange(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to) {
      onChange('custom', { from, to });
    }
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${
              value === p.key
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="date"
            value={customFrom}
            onChange={e => handleCustomChange(e.target.value, customTo)}
            className="flex-1 text-[12px] text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-green-500"
          />
          <span className="text-[11px] text-gray-400">to</span>
          <input
            type="date"
            value={customTo}
            onChange={e => handleCustomChange(customFrom, e.target.value)}
            className="flex-1 text-[12px] text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-green-500"
          />
        </div>
      )}
    </div>
  );
}

/** Helper: check if a date string falls within a DateRange */
export function isInRange(dateStr: string | null | undefined, range: DateRange | null): boolean {
  if (!range) return true;
  if (!dateStr) return false;
  const d = dateStr.substring(0, 10); // YYYY-MM-DD — handles both "T" and space separators
  return d >= range.from && d <= range.to;
}
