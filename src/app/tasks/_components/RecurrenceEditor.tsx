'use client';

import { useState } from 'react';
import type { RecurrenceRule, RecurrenceType, RecurrenceEndType, MonthlyMode } from '@/lib/odoo-tasks';

interface Props {
  value: RecurrenceRule;
  onChange: (next: RecurrenceRule) => void;
}

const TYPE_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: 'once', label: 'One-off date' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const UNIT_LABEL: Record<RecurrenceType, string> = {
  once: '',
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const POS_OPTIONS = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: -1, label: 'last' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

export default function RecurrenceEditor({ value, onChange }: Props) {
  const v = value;
  const set = (patch: Partial<RecurrenceRule>) => onChange({ ...v, ...patch });

  function toggleWeekday(i: number) {
    const has = v.weekdays.includes(i);
    set({ weekdays: has ? v.weekdays.filter(w => w !== i) : [...v.weekdays, i].sort() });
  }

  const [newException, setNewException] = useState('');
  function addException() {
    if (!newException) return;
    if (v.exception_dates.includes(newException)) { setNewException(''); return; }
    set({ exception_dates: [...v.exception_dates, newException].sort() });
    setNewException('');
  }
  function removeException(d: string) {
    set({ exception_dates: v.exception_dates.filter(x => x !== d) });
  }

  return (
    <div className="space-y-3 border border-gray-200 rounded-xl p-3 bg-gray-50">
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Repeat</label>
        <select
          value={v.type}
          onChange={e => set({ type: e.target.value as RecurrenceType })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
        >
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {v.type === 'once' && (
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Date</label>
          <input
            type="date"
            value={v.one_off_date || ''}
            onChange={e => set({ one_off_date: e.target.value || null })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
          />
        </div>
      )}

      {v.type !== 'once' && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Every</label>
          <input
            type="number" min={1} value={v.interval}
            onChange={e => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
          />
          <span className="text-sm text-gray-700">{UNIT_LABEL[v.type]}{v.interval !== 1 ? 's' : ''}</span>
        </div>
      )}

      {v.type === 'weekly' && (
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">On weekdays</label>
          <div className="flex gap-1.5">
            {WEEKDAYS.map((label, i) => (
              <button
                key={i} type="button"
                onClick={() => toggleWeekday(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  v.weekdays.includes(i) ? 'bg-orange-500 text-white' : 'bg-white text-gray-400 border border-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(v.type === 'monthly' || v.type === 'yearly') && (
        <>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Pattern</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={v.monthly_mode === 'day_of_month'}
                  onChange={() => set({ monthly_mode: 'day_of_month' as MonthlyMode })}
                />
                On day
                <input
                  type="number" min={-1} max={31} value={v.day_of_month}
                  onChange={e => set({ day_of_month: parseInt(e.target.value, 10) || 1 })}
                  className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
                />
                <span className="text-xs text-gray-500">(use -1 for last day)</span>
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={v.monthly_mode === 'weekday_of_month'}
                  onChange={() => set({ monthly_mode: 'weekday_of_month' as MonthlyMode })}
                />
                On the
                <select
                  value={v.weekday_pos}
                  onChange={e => set({ weekday_pos: parseInt(e.target.value, 10) })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  {POS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={v.weekday}
                  onChange={e => set({ weekday: parseInt(e.target.value, 10) })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  {WEEKDAYS.map((label, i) => <option key={i} value={i}>{label}</option>)}
                </select>
                of the month
              </label>
            </div>
          </div>
          {v.type === 'yearly' && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">In month</label>
              <select
                value={v.month}
                onChange={e => set({ month: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Starts on</label>
        <input
          type="date" value={v.start_date}
          onChange={e => set({ start_date: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        />
      </div>

      {v.type !== 'once' && (
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Ends</label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={v.end_type === 'never'} onChange={() => set({ end_type: 'never' as RecurrenceEndType })} />
              Never
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={v.end_type === 'on_date'} onChange={() => set({ end_type: 'on_date' as RecurrenceEndType })} />
              On
              <input
                type="date" value={v.end_date || ''}
                onChange={e => set({ end_date: e.target.value || null, end_type: 'on_date' })}
                className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={v.end_type === 'after_count'} onChange={() => set({ end_type: 'after_count' as RecurrenceEndType })} />
              After
              <input
                type="number" min={1} value={v.count || 1}
                onChange={e => set({ count: Math.max(1, parseInt(e.target.value, 10) || 1), end_type: 'after_count' })}
                className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
              />
              times
            </label>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Skip these days</label>
        {v.exception_dates.length > 0 && (
          <ul className="mb-2 space-y-1">
            {v.exception_dates.map(d => (
              <li key={d} className="flex items-center gap-2 text-sm text-gray-700 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200">
                <span className="flex-1">{d}</span>
                <button onClick={() => removeException(d)} className="text-xs text-red-500 hover:text-red-600">Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            type="date" value={newException}
            onChange={e => setNewException(e.target.value)}
            className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
          />
          <button
            type="button" onClick={addException}
            disabled={!newException}
            className="px-3 py-1.5 bg-orange-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}
