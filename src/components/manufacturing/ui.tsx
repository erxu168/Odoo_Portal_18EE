'use client';

import React from 'react';

// --- Status Dot ---
export function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: 'bg-emerald-600',
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

// --- Pick Circle (tap-to-check) ---
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
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className={`${dims} rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
        checked
          ? 'bg-emerald-600 border-emerald-600'
          : 'border-gray-300 bg-white'
      }`}
      aria-label={checked ? 'Marked as picked' : 'Mark as picked'}
    >
      {checked && (
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

// --- Progress Bar ---
export function ProgressBar({
  value,
  max,
  label,
  color = 'blue',
}: {
  value: number;
  max: number;
  label?: string;
  color?: 'blue' | 'green';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fillColor = color === 'green' ? 'bg-emerald-600' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2 px-5 py-2">
      {label && (
        <span className="text-xs text-gray-500 whitespace-nowrap">{label}</span>
      )}
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${fillColor} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 min-w-[32px] text-right">
        {value}/{max}
      </span>
    </div>
  );
}

// --- Badge ---
export function Badge({
  variant,
  children,
}: {
  variant: 'done' | 'progress' | 'ready' | 'draft' | 'pending' | 'warning';
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    done: 'bg-emerald-50 text-emerald-800',
    progress: 'bg-amber-50 text-amber-800',
    ready: 'bg-blue-50 text-blue-800',
    draft: 'bg-gray-100 text-gray-600',
    pending: 'bg-gray-100 text-gray-500',
    warning: 'bg-amber-50 text-amber-700',
  };
  return (
    <span
      className={`text-[11px] px-2.5 py-0.5 rounded-full whitespace-nowrap font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

// --- Timer Display ---
export function TimerDisplay({
  seconds,
  isRunning,
}: {
  seconds: number;
  isRunning: boolean;
}) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const formatted = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <span
      className={`font-mono text-[32px] font-medium tracking-wide ${
        isRunning ? 'text-gray-900' : 'text-gray-400'
      }`}
    >
      {formatted}
    </span>
  );
}

// --- Timer Chip (compact for cards) ---
export function TimerChip({ minutes }: { minutes: number }) {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  const display = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return (
    <span className="font-mono text-[13px] font-medium bg-gray-100 text-gray-900 px-2.5 py-0.5 rounded-xl">
      {display}
    </span>
  );
}

// --- Back Header ---
// FIX: Changed from <a href> to <button onClick> so the onBack callback works
export function BackHeader({
  backLabel,
  onBack,
  title,
  subtitle,
}: {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white px-5 pt-3.5 pb-3.5 border-b border-gray-200">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 mb-1 text-emerald-600 text-[13px] active:opacity-70"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M15 19l-7-7 7-7" />
        </svg>
        {backLabel}
      </button>
      <h1 className="text-lg font-semibold text-gray-900">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[13px] text-gray-500 mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-gray-500 px-5 pt-3.5 pb-2">
      {children}
    </h2>
  );
}

// --- Action Button ---
export function ActionButton({
  variant = 'primary',
  children,
  onClick,
  disabled,
}: {
  variant?: 'primary' | 'outline' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    primary: 'bg-emerald-600 text-white',
    outline: 'bg-transparent text-emerald-700 border border-emerald-300',
    success: 'bg-emerald-600 text-white',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3 rounded-lg text-sm font-medium text-center transition-opacity ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : 'active:opacity-80'}`}
    >
      {children}
    </button>
  );
}
