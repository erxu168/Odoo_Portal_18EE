'use client';

import React from 'react';
import { currentWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * Shared UI components for the shifts module.
 * All colors follow DESIGN_GUIDE.md — semantic only.
 * All font sizes use var(--fs-*) tokens.
 */

/**
 * Open a native date/time picker from a click. Mobile browsers open the picker
 * on any tap of a <input type="date">, but DESKTOP browsers only open it from the
 * (often invisible) calendar icon — a click on the field does nothing. Calling
 * showPicker() inside the click gesture fixes desktop while leaving mobile as-is.
 */
export function openNativePicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    /* older browsers / blocked context — the field still works via the icon + keyboard */
  }
}

// --- Search Bar ---
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="px-4 pb-3">
      <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl px-3.5 h-12 focus-within:border-green-500 transition-colors">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2"/>
          <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Search...'}
          className="flex-1 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400" />
        {value && (
          <button onClick={() => onChange('')} className="text-gray-400 active:text-gray-600" aria-label="Clear search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// --- Loading Spinner ---
export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
    </div>
  );
}

// --- Empty State ---
export function EmptyState({ icon, title, body }: { icon?: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <p className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">{title}</p>
      {body && <p className="text-[var(--fs-base)] text-gray-500 max-w-[220px] leading-relaxed">{body}</p>}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-widest uppercase px-5 pt-4 pb-2">{children}</h2>;
}

// --- Badge (semantic tints per DESIGN_GUIDE) ---
export type BadgeVariant = 'red' | 'amber' | 'blue' | 'green' | 'gray' | 'orange';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  gray: 'bg-gray-100 text-gray-700',
  orange: 'bg-orange-50 text-orange-700',
};

export function Badge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  return (
    <span className={`text-[var(--fs-xs)] px-2 py-0.5 rounded-md font-bold whitespace-nowrap ${BADGE_STYLES[variant]}`}>
      {children}
    </span>
  );
}

// --- Week Navigation (‹ 6 – 12 Jul ›) ---
export function WeekNav({ weekKey, label, onPrev, onNext, onJumpDate, onToday }: {
  weekKey: string; label: string; onPrev: () => void; onNext: () => void;
  /** Jump to the ISO week of an arbitrary date (from the tap-to-pick date input). */
  onJumpDate?: (dateStr: string) => void;
  /** Reset to the current week; only shown when off it. */
  onToday?: () => void;
}) {
  const isCurrentWeek = weekKey === currentWeekKey();
  const weekNum = Number(weekKey.match(/-W(\d+)/)?.[1] ?? 0);
  // Seed the picker on the Monday of the shown week.
  const pickerValue = weekKeyDays(weekKey)[0];
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-2.5 py-2 mx-4 mb-3">
      <button onClick={onPrev} aria-label="Previous week"
        className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      {/* Tap the title to open the OS date picker and jump to any week. The date
          input sits transparently over the label so a tap anywhere opens it. */}
      <div className="relative flex-1 min-w-0">
        <div className="flex items-center justify-center gap-1 text-[var(--fs-md)] font-bold text-gray-900 min-w-0 pointer-events-none">
          <span className="truncate">
            {label}
            {weekNum > 0 && <span className="text-gray-400 font-semibold"> {'·'} Week {weekNum}</span>}
            {isCurrentWeek && <span className="text-gray-400 font-semibold"> {'·'} this week</span>}
          </span>
          {onJumpDate && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
        </div>
        {onJumpDate && (
          <input
            type="date"
            value={pickerValue}
            onChange={e => { if (e.target.value) onJumpDate(e.target.value); }}
            onClick={openNativePicker}
            aria-label="Jump to a date"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        )}
      </div>
      <button onClick={onNext} aria-label="Next week"
        className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200 flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      {onToday && !isCurrentWeek && (
        <button onClick={onToday} aria-label="Go to this week"
          className="px-3 h-9 rounded-lg bg-green-50 text-green-700 text-[var(--fs-sm)] font-bold flex items-center justify-center active:bg-green-100 flex-shrink-0 whitespace-nowrap">
          Today
        </button>
      )}
    </div>
  );
}

// --- Stat Chip (Shifts / Open / Over cap) ---
export function StatChip({ value, label, tone }: { value: string | number; label: string; tone?: 'default' | 'amber' | 'red' }) {
  const toneClass = tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-xl px-2 py-2.5 text-center min-w-0">
      <div className={`text-[var(--fs-xxl)] font-extrabold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-[var(--fs-xs)] font-semibold tracking-wider uppercase text-gray-500 mt-0.5 truncate">{label}</div>
    </div>
  );
}

// --- Bottom Sheet ---
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/45 flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto px-4 pt-2.5 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mb-3" />
        {children}
      </div>
    </div>
  );
}

// --- Toggle Switch (green when on) ---
export function ToggleSwitch({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-11 h-[26px] rounded-full flex-shrink-0 transition-colors ${on ? 'bg-green-600' : 'bg-gray-300'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <span
        className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`}
      />
    </button>
  );
}
