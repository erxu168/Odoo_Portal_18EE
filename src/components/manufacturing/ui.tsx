'use client';

import React from 'react';

// --- Status Dot ---
export function StatusDot({ status }: { status: 'ok' | 'low' | 'out' }) {
  const colors = {
    ok: 'bg-emerald-600',
    low: 'bg-amber-500',
    out: 'bg-red-500',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} mr-1.5 align-middle`}
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
          : 'border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-600'
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
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
    done: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    progress: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    ready: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    pending: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
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
        isRunning ? 'text-gray-900 dark:text-white' : 'text-gray-400'
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
    <span className="font-mono text-[13px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-2.5 py-0.5 rounded-xl">
      {display}
    </span>
  );
}

// --- Back Header ---
export function BackHeader({
  backLabel,
  backHref,
  title,
  subtitle,
}: {
  backLabel: string;
  backHref: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 px-5 pt-3.5 pb-3.5 border-b border-gray-200 dark:border-gray-700">
      <a
        href={backHref}
        className="flex items-center gap-2 mb-1 text-blue-600 dark:text-blue-400 text-[13px]"
      >
        <span className="text-lg leading-none">&lsaquo;</span>
        {backLabel}
      </a>
      <h1 className="text-lg font-medium text-gray-900 dark:text-white">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 px-5 pt-3.5 pb-2">
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
    primary:
      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    outline:
      'bg-transparent text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-600',
    success:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    warning:
      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    danger:
      'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3 rounded-lg text-sm font-medium text-center transition-opacity ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : 'active:opacity-75'}`}
    >
      {children}
    </button>
  );
}
