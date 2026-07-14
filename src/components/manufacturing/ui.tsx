'use client';

import React from 'react';

// --- Status Dot ---
export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: 'bg-green-500',
    low: 'bg-amber-500',
    out: 'bg-red-500',
    none: 'bg-gray-300',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-300'} mr-1.5 align-middle`}
    />
  );
}

// --- Pick Circle ---
export function PickCircle({
  checked,
  onToggle,
  size = 'md',
}: {
  checked: boolean;
  onToggle?: () => void;
  size?: 'sm' | 'md';
}) {
  const dims = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
      className={`${dims} rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
        checked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
      }`}
    >
      {checked && (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
      )}
    </button>
  );
}

// --- Progress Bar ---
export function ProgressBar({ value, max, label, color = 'orange' }: { value: number; max: number; label?: string; color?: 'orange' | 'green' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fillColor = color === 'green' ? 'bg-green-500' : 'bg-green-600';
  return (
    <div className="flex items-center gap-2 px-5 py-2">
      {label && <span className="text-xs text-gray-500 whitespace-nowrap">{label}</span>}
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${fillColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 min-w-[32px] text-right">{value}/{max}</span>
    </div>
  );
}

// --- Timer Display (full size, used in ActiveWorkOrder) ---
export function TimerDisplay({ seconds, isRunning }: { seconds: number; isRunning?: boolean }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className={`text-[32px] font-light tabular-nums tracking-widest font-mono ${isRunning ? 'text-green-600' : 'text-gray-900'}`}>
      {mm}:{ss}
    </div>
  );
}

// --- Timer Chip (compact, used in WorkOrderList) ---
export function TimerChip({ minutes }: { minutes: number }) {
  const mm = Math.floor(minutes);
  const ss = Math.round((minutes - mm) * 60);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-500">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  );
}

// --- Badge ---
export function Badge({ variant, children }: { variant: 'done' | 'progress' | 'ready' | 'draft' | 'pending' | 'warning'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    done: 'bg-green-50 text-green-700',
    progress: 'bg-amber-50 text-amber-700',
    ready: 'bg-green-50 text-green-800',
    draft: 'bg-gray-100 text-gray-600',
    pending: 'bg-gray-100 text-gray-500',
    warning: 'bg-amber-50 text-amber-700',
  };
  return (
    <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md whitespace-nowrap font-semibold ${styles[variant]}`}>{children}</span>
  );
}

// --- Back Header ---
export function BackHeader({ backLabel, onBack, title, subtitle }: { backLabel: string; onBack: () => void; title: string; subtitle?: string }) {
  return (
    <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
      <button type="button" onClick={onBack} className="flex items-center gap-1 mb-2 text-green-700 text-[var(--fs-xs)] font-semibold active:opacity-70">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
        {backLabel}
      </button>
      <h1 className="text-[var(--fs-lg)] font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-widest uppercase px-5 pt-4 pb-2">{children}</h2>;
}

// --- Action Button ---
export function ActionButton({ variant = 'primary', children, onClick, disabled }: { variant?: 'primary' | 'outline' | 'success' | 'warning' | 'danger'; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  const styles: Record<string, string> = {
    primary: 'bg-green-600 text-white shadow-lg shadow-green-600/30',
    outline: 'bg-transparent text-green-700 border border-green-300',
    success: 'bg-green-500 text-white shadow-lg shadow-green-500/30',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full py-4 rounded-xl text-[var(--fs-md)] font-bold text-center transition-all active:scale-[0.975] ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >{children}</button>
  );
}
