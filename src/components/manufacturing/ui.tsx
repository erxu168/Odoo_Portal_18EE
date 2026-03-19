'use client';

import React from 'react';

// --- Status Dot ---
export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: 'bg-emerald-500',
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
        checked ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'
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
  const fillColor = color === 'green' ? 'bg-emerald-500' : 'bg-orange-500';
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

// --- Timer Display ---
export function TimerDisplay({ seconds, isRunning }: { seconds: number; isRunning?: boolean }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className={`text-[32px] font-light tabular-nums tracking-widest font-mono ${isRunning ? 'text-orange-500' : 'text-gray-900'}`}>
      {mm}:{ss}
    </div>
  );
}

// --- Badge ---
export function Badge({ variant, children }: { variant: 'done' | 'progress' | 'ready' | 'draft' | 'pending' | 'warning'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    done: 'bg-emerald-50 text-emerald-700',
    progress: 'bg-amber-50 text-amber-700',
    ready: 'bg-orange-50 text-orange-700',
    draft: 'bg-gray-100 text-gray-600',
    pending: 'bg-gray-100 text-gray-500',
    warning: 'bg-amber-50 text-amber-700',
  };
  return (
    <span className={`text-[11px] px-2.5 py-0.5 rounded-md whitespace-nowrap font-semibold ${styles[variant]}`}>{children}</span>
  );
}

// --- Back Header ---
export function BackHeader({ backLabel, onBack, title, subtitle }: { backLabel: string; onBack: () => void; title: string; subtitle?: string }) {
  return (
    <div className="bg-white px-5 pt-4 pb-4 border-b border-gray-200">
      <button type="button" onClick={onBack} className="flex items-center gap-1 mb-2 text-orange-600 text-[13px] font-semibold active:opacity-70">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
        {backLabel}
      </button>
      <h1 className="text-[18px] font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase px-5 pt-4 pb-2">{children}</h2>;
}

// --- Action Button ---
export function ActionButton({ variant = 'primary', children, onClick, disabled }: { variant?: 'primary' | 'outline' | 'success' | 'warning' | 'danger'; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  const styles: Record<string, string> = {
    primary: 'bg-orange-500 text-white shadow-lg shadow-orange-500/30',
    outline: 'bg-transparent text-orange-600 border border-orange-300',
    success: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full py-4 rounded-xl text-[15px] font-bold text-center transition-all active:scale-[0.975] ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >{children}</button>
  );
}
