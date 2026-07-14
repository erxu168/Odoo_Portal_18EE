'use client';

import React, { useState } from 'react';

/**
 * StandardFilter — reusable date range filter component.
 * Presets: Today, This week, Last week, Last month, Custom.
 * Custom mode shows two date pickers (from/to).
 * Returns { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } or null.
 * Use across all modules: Inventory, Purchase, Manufacturing, etc.
 */

type Preset = 'today' | 'this_week' | 'last_week' | 'last_month' | 'custom';

interface StandardFilterProps {
  onChange: (range: { from: string; to: string } | null) => void;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPresetRange(preset: Preset): { from: string; to: string } | null {
  const now = new Date();
  const today = localDate(now);

  if (preset === 'today') {
    return { from: today, to: today };
  }

  if (preset === 'this_week') {
    const day = now.getDay();
    const diffToMon = day === 0 ? 6 : day - 1;
    const mon = new Date(now);
    mon.setDate(now.getDate() - diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { from: localDate(mon), to: localDate(sun) };
  }

  if (preset === 'last_week') {
    const day = now.getDay();
    const diffToMon = day === 0 ? 6 : day - 1;
    const thisMon = new Date(now);
    thisMon.setDate(now.getDate() - diffToMon);
    const lastMon = new Date(thisMon);
    lastMon.setDate(thisMon.getDate() - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    return { from: localDate(lastMon), to: localDate(lastSun) };
  }

  if (preset === 'last_month') {
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfPrevMonth = new Date(firstOfThisMonth);
    lastOfPrevMonth.setDate(0);
    const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
    return { from: localDate(firstOfPrevMonth), to: localDate(lastOfPrevMonth) };
  }

  return null;
}

export default function StandardFilter({ onChange }: StandardFilterProps) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  function handlePreset(p: Preset) {
    if (p === preset) {
      setPreset(null);
      onChange(null);
      return;
    }
    setPreset(p);
    if (p === 'custom') {
      if (customFrom && customTo) {
        onChange({ from: customFrom, to: customTo });
      }
      return;
    }
    const range = getPresetRange(p);
    onChange(range);
  }

  function handleCustomDate(field: 'from' | 'to', value: string) {
    if (field === 'from') setCustomFrom(value);
    else setCustomTo(value);
    const from = field === 'from' ? value : customFrom;
    const to = field === 'to' ? value : customTo;
    if (from && to) {
      onChange({ from, to });
    }
  }

  const presets: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'this_week', label: 'This week' },
    { key: 'last_week', label: 'Last week' },
    { key: 'last_month', label: 'Last month' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {presets.map((p) => (
          <button key={p.key} onClick={() => handlePreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
              preset === p.key
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex gap-2 mt-2">
          <div className="flex-1">
            <label className="text-[10px] text-gray-400 font-semibold uppercase">From</label>
            <input type="date" value={customFrom}
              onChange={(e) => handleCustomDate('from', e.target.value)}
              className="w-full mt-0.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 outline-none focus:border-green-500" />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-400 font-semibold uppercase">To</label>
            <input type="date" value={customTo}
              onChange={(e) => handleCustomDate('to', e.target.value)}
              className="w-full mt-0.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 outline-none focus:border-green-500" />
          </div>
        </div>
      )}
    </div>
  );
}
