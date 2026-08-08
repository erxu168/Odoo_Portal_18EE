'use client';

// Closing Report — shared client bits: API types (mirroring the routes), a
// fetch helper that surfaces server error messages, night formatting, and the
// big-touch answer controls used by both the fill form and the read views.
import React from 'react';

export type QType = 'yes_no' | 'choice' | 'rating' | 'text';

export interface ApiQuestion {
  id: number;
  position: number;
  text: string;
  qtype: QType;
  options: string[];
  problem_values: string[];
}

export interface ApiAnswer {
  id: number;
  question_id: number | null;
  position: number;
  question_text: string;
  qtype: QType;
  options: string[];
  problem_values: string[];
  value: string;
  is_problem: boolean;
  note: string | null;
  task_line_id: number | null;
  photos: string[];
}

export interface ApiReport {
  id: number;
  company_id: number;
  department_id: number;
  report_date: string;
  submitted_at: string;
  submitted_by_user_id: number | null;
  submitted_by_name: string;
  updated_at: string;
  answers: ApiAnswer[];
}

export interface DeptEntry {
  id: number;
  name: string;
  question_count: number;
  report: { id: number; submitted_by_name: string; submitted_at: string } | null;
}

export class ApiError extends Error {
  status: number;
  errors?: Record<number, string>;
  constructor(status: number, message: string, errors?: Record<number, string>) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const b = (body || {}) as { error?: string; errors?: Record<number, string> };
    throw new ApiError(res.status, b.error || 'Something went wrong. Please try again.', b.errors);
  }
  return body as T;
}

/** "2026-08-08" → "Fri 8 Aug" (the label everyone recognises for a night). */
export function fmtNight(day: string): string {
  const t = Date.parse(day + 'T12:00:00Z');
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "…T21:41:00.000Z" ISO → Berlin wall-clock "23:41". */
export function fmtTimeBerlin(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

export function answerLabel(a: { qtype: QType; value: string }): string {
  if (a.qtype === 'yes_no') return a.value === 'yes' ? 'Yes' : a.value === 'no' ? 'No' : a.value;
  if (a.qtype === 'rating') return a.value ? `${a.value} / 5` : '';
  return a.value;
}

export const QTYPE_LABEL: Record<QType, string> = {
  yes_no: 'Yes / No',
  choice: 'Choose one',
  rating: 'Rating 1–5',
  text: 'Short text · optional',
};

/** One row of big tap targets; the selected value highlights (red when it flags a problem). */
export function OptionButtons({ values, labels, selected, problemValues, onSelect, disabled }: {
  values: string[];
  labels?: string[];
  selected: string;
  problemValues: string[];
  onSelect: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {values.map((v, i) => {
        const sel = selected === v;
        const bad = problemValues.includes(v);
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(v)}
            className={`flex-1 basis-[calc(50%-0.25rem)] min-h-[46px] rounded-xl border-[1.5px] text-[15px] font-semibold transition-colors ${
              sel
                ? bad
                  ? 'bg-red-50 border-red-500 text-red-600'
                  : 'bg-green-50 border-green-600 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 active:bg-gray-100'
            }`}
          >
            {labels?.[i] ?? v}
          </button>
        );
      })}
    </div>
  );
}

export function RatingButtons({ selected, problemValues, onSelect, disabled }: {
  selected: string;
  problemValues: string[];
  onSelect: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 mt-3">
      {['1', '2', '3', '4', '5'].map((v) => {
        const sel = selected === v;
        const bad = problemValues.includes(v);
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(v)}
            className={`flex-1 min-h-[48px] rounded-xl border-[1.5px] text-base font-bold transition-colors ${
              sel
                ? bad
                  ? 'bg-red-50 border-red-500 text-red-600'
                  : 'bg-green-50 border-green-600 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-500 active:bg-gray-100'
            }`}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
