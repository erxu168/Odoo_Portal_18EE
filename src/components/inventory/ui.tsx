'use client';

import React from 'react';

// --- Filter Pill Bar ---
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-4 pb-3">{children}</div>;
}

export function FilterPill({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
        active ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
      }`}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );
}

// --- Status Badge ---
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  submitted: 'bg-purple-50 text-purple-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  daily: 'bg-emerald-50 text-emerald-700',
  weekly: 'bg-blue-50 text-blue-700',
  monthly: 'bg-purple-50 text-purple-700',
  adhoc: 'bg-amber-50 text-amber-700',
  person: 'bg-blue-50 text-blue-700',
  department: 'bg-purple-50 text-purple-700',
  shift: 'bg-orange-50 text-orange-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', submitted: 'Submitted',
  approved: 'Approved', rejected: 'Rejected',
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', adhoc: 'Ad-hoc',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`text-[11px] px-2.5 py-0.5 rounded-md font-semibold whitespace-nowrap ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-500'}`}>
      {label || STATUS_LABELS[status] || status}
    </span>
  );
}

// --- Stepper ---
export function Stepper({
  value, uom, onMinus, onPlus, onTap,
}: {
  value: number | null; uom: string;
  onMinus: () => void; onPlus: () => void; onTap: () => void;
}) {
  const hasVal = value !== null && value !== undefined;
  return (
    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden h-11 flex-shrink-0">
      <button onClick={(e) => { e.stopPropagation(); onMinus(); }}
        className="w-11 h-11 flex items-center justify-center text-gray-600 text-lg active:bg-gray-100 border-r border-gray-200 select-none">
        &minus;
      </button>
      <button onClick={(e) => { e.stopPropagation(); onTap(); }}
        className="min-w-[56px] h-11 flex flex-col items-center justify-center px-1 active:bg-gray-50">
        <span className={`font-mono text-[15px] font-semibold leading-tight ${hasVal ? 'text-emerald-600' : 'text-gray-300'}`}>
          {hasVal ? value : '--'}
        </span>
        <span className="text-[9px] text-gray-400 leading-tight">{uom}</span>
      </button>
      <button onClick={(e) => { e.stopPropagation(); onPlus(); }}
        className="w-11 h-11 flex items-center justify-center text-gray-600 text-lg active:bg-gray-100 border-l border-gray-200 select-none font-semibold">
        +
      </button>
    </div>
  );
}

// --- Progress Bar ---
export function CountProgress({ counted, total }: { counted: number; total: number }) {
  const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 px-5 py-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-gray-400">{counted}/{total}</span>
    </div>
  );
}

// --- Search Bar ---
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="px-4 pb-3">
      <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-orange-400 transition-colors">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Search...'}
          className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400" />
        {value && (
          <button onClick={() => onChange('')} className="text-gray-400 active:text-gray-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// --- Back Header ---
export function BackHeader({ onBack, title, subtitle, right }: {
  onBack: () => void; title: string; subtitle?: string; right?: React.ReactNode;
}) {
  return (
    <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
      <div className="flex items-center justify-between mb-1">
        <button onClick={onBack} className="flex items-center gap-1 text-orange-600 text-[13px] font-semibold active:opacity-70">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
        {right}
      </div>
      <h1 className="text-[18px] font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// --- Loading Spinner ---
export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
    </div>
  );
}

// --- Empty State ---
export function EmptyState({ icon, title, body }: { icon?: string; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <p className="text-[15px] font-semibold text-gray-900 mb-1">{title}</p>
      {body && <p className="text-[13px] text-gray-500 max-w-[220px] leading-relaxed">{body}</p>}
    </div>
  );
}

// --- Section Title ---
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase px-5 pt-4 pb-2">{children}</h2>;
}
