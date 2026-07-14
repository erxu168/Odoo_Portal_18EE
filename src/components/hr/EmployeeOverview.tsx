'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';
import { useCompany } from '@/lib/company-context';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onSelect: (id: number) => void;
  onAdd: () => void;
}

type Filter = 'all' | 'incomplete' | 'expiring';

export default function EmployeeOverview({ onBack, onSelect, onAdd }: Props) {
  // The active restaurant comes from the header company switcher (useCompany),
  // so this screen has no company/department dropdowns of its own — it simply
  // follows the header selection.
  const { companyId } = useCompany();
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Load the active company's staff whenever the company (or status filter) changes.
  useEffect(() => {
    if (!companyId) return; // wait for the header company to resolve
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter !== 'all') params.set('filter', filter);
        params.set('company_id', String(companyId));
        const res = await fetch('/api/hr/employees?' + params.toString());
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setEmployees(data.employees || []);
        }
      } catch {
        console.error('Failed to load employees');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filter, companyId]);

  const filtered = search
    ? employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : employees;

  const incomplete = employees.filter(e => e.kw_onboarding_status !== 'complete').length;
  const expiring = employees.filter(e => {
    if (!e.visa_expire) return false;
    const days = (new Date(e.visa_expire).getTime() - Date.now()) / 86400000;
    return days > 0 && days <= 90;
  }).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <AppHeader title="Employees" subtitle={employees.length + ' active'} showBack onBack={onBack} />

      {/* Search */}
      <div className="px-5 pt-4 pb-3">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-[var(--fs-base)] bg-white outline-none focus:border-green-600"
            placeholder="Search employees..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status filter badges */}
      <div className="flex gap-2 px-5 pb-3 overflow-x-auto">
        <FilterBadge label={'All (' + employees.length + ')'} active={filter === 'all'} onClick={() => setFilter('all')} color="green" />
        <FilterBadge label={'Incomplete (' + incomplete + ')'} active={filter === 'incomplete'} onClick={() => setFilter('incomplete')} color="amber" />
        <FilterBadge label={'Expiring (' + expiring + ')'} active={filter === 'expiring'} onClick={() => setFilter('expiring')} color="red" />
      </div>

      {/* Employee list */}
      {loading ? (
        <div className="flex items-center justify-center h-20">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 mt-10 text-[var(--fs-sm)]">No employees found</div>
      ) : (
        filtered.map(emp => {
          const pct = calculateOnboardingPercent(emp);
          const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          const deptFull = emp.department_id ? (emp.department_id as [number, string])[1] : '';
          const dept = deptFull.includes(' / ') ? deptFull.split(' / ').pop()! : deptFull;
          const visaDays = emp.visa_expire ? Math.round((new Date(emp.visa_expire).getTime() - Date.now()) / 86400000) : null;
          const pctColor = pct === 100 ? 'text-green-600' : pct > 0 ? 'text-amber-600' : 'text-red-500';

          return (
            <button
              key={emp.id}
              onClick={() => onSelect(emp.id)}
              className="w-full mx-5 mb-2 bg-white rounded-2xl p-4 flex items-center gap-3 border border-gray-200 text-left active:bg-gray-50"
              style={{ width: 'calc(100% - 40px)' }}
            >
              <div className="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[var(--fs-sm)] flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-md)] font-bold text-gray-900">{emp.name}</div>
                <div className="text-[var(--fs-xs)] text-gray-500">
                  {dept}
                  {visaDays !== null && visaDays <= 90 && visaDays > 0 && (
                    <span className="text-red-500 font-semibold"> &middot; Visa exp. {Math.round(visaDays)}d</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={'text-[var(--fs-xxl)] font-bold font-mono ' + pctColor}>{pct}%</div>
                <div className="text-[var(--fs-xs)] text-gray-400">{pct === 100 ? 'complete' : pct === 0 ? 'not started' : 'incomplete'}</div>
              </div>
            </button>
          );
        })
      )}

      {/* Add staff */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        <button
          onClick={onAdd}
          className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 py-4 bg-green-600 text-white font-bold text-[var(--fs-base)] rounded-xl shadow-lg active:opacity-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add staff
        </button>
      </div>
    </div>
  );
}

function FilterBadge({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: string }) {
  const bg = active
    ? (color === 'green' ? 'bg-green-100 text-green-700' : color === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')
    : 'bg-gray-100 text-gray-500';
  return (
    <button onClick={onClick} className={'whitespace-nowrap px-4 py-3 rounded-full text-[var(--fs-sm)] font-bold ' + bg}>
      {label}
    </button>
  );
}
