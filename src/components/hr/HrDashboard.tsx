'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';

interface Props {
  onNavigate: (tile: string) => void;
  onHome: () => void;
}

export default function HrDashboard({ onNavigate, onHome }: Props) {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/hr/employee');
        if (res.ok) {
          const data = await res.json();
          setEmployee(data.employee);
        }
        // Check if manager by trying employees endpoint
        const mgrRes = await fetch('/api/hr/employees?filter=all');
        setIsManager(mgrRes.ok);
      } catch (_e: unknown) {
        console.error('Failed to load HR dashboard');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const pct = employee ? calculateOnboardingPercent(employee) : 0;
  const isComplete = employee?.kw_onboarding_status === 'complete';
  const docCount = employee?.kw_doc_count ?? 0;
  const requiredDocs = 5;
  const uploadedDocs = employee
    ? [
        employee.kw_doc_ausweis_ok,
        employee.kw_doc_steuer_id_ok,
        employee.kw_doc_sv_ausweis_ok,
        employee.kw_doc_gesundheitszeugnis_ok,
        employee.kw_doc_vertrag_ok,
      ].filter(Boolean).length
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="HR & Onboarding" />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Onboarding alert */}
          {employee && !isComplete && (
            <div className="mx-5 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
              <span className="text-amber-600 text-lg leading-none">!</span>
              <div className="text-[var(--fs-sm)] text-amber-800">
                Your onboarding is <strong>incomplete</strong> ({pct}%). Tap
                &quot;Onboarding&quot; to continue.
              </div>
            </div>
          )}

          {/* Staff tiles */}
          <div className="grid grid-cols-2 gap-3 p-5">
            <DashTile
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              bg="bg-green-50" border="border-green-200" iconBg="bg-green-100" iconColor="text-green-600"
              label="My Profile"
              sub="View & edit your info"
              onClick={() => onNavigate('profile')}
            />
            {!isComplete ? (
              <DashTile
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>}
                bg="bg-amber-50" border="border-amber-200" iconBg="bg-amber-100" iconColor="text-amber-600"
                label="Onboarding"
                sub={`Step ${getStep(employee)} of 6`}
                badge="!"
                onClick={() => onNavigate('onboarding')}
              />
            ) : (
              <DashTile
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>}
                bg="bg-green-50" border="border-green-200" iconBg="bg-green-100" iconColor="text-green-600"
                label="Onboarding"
                sub="Complete"
                onClick={() => onNavigate('onboarding')}
              />
            )}
            <DashTile
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>}
              bg="bg-blue-50" border="border-blue-200" iconBg="bg-blue-100" iconColor="text-blue-600"
              label="My Documents"
              sub={`${uploadedDocs} of ${requiredDocs} uploaded`}
              onClick={() => onNavigate('documents')}
            />
            <DashTile
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              bg="bg-gray-50" border="border-gray-200" iconBg="bg-gray-100" iconColor="text-gray-400"
              label="Help"
              sub="Coming soon"
              disabled
            />
          </div>

          {/* Manager section */}
          {isManager && (
            <>
              <div className="px-5 pt-2 pb-1">
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
                  Manager Tools
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                <DashTile
                  icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>}
                  bg="bg-blue-50" border="border-blue-200" iconBg="bg-purple-100" iconColor="text-blue-600"
                  label="Employees"
                  sub="View all staff"
                  onClick={() => onNavigate('employees')}
                />
                <DashTile
                  icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
                  bg="bg-gray-50" border="border-gray-200" iconBg="bg-gray-100" iconColor="text-gray-400"
                  label="DATEV Export"
                  sub="Coming soon"
                  disabled
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function getStep(emp: EmployeeData | null): number {
  if (!emp) return 1;
  if (!emp.birthday || !emp.private_street) return 1;
  if (!emp.bank_account_id) return 2;
  if (!emp.kw_steuer_id && !emp.kw_steuerklasse) return 3;
  if (!emp.ssnid && !emp.kw_krankenkasse_name) return 4;
  if (!emp.kw_doc_ausweis_ok || !emp.kw_doc_gesundheitszeugnis_ok) return 5;
  return 6;
}

interface TileProps {
  icon: React.ReactNode;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  label: string;
  sub: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}

function DashTile({ icon, bg, border, iconBg, iconColor, label, sub, badge, disabled, onClick }: TileProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`rounded-2xl p-4 flex flex-col items-start gap-2 border text-left relative shadow-sm active:scale-[0.97] transition-transform ${
        disabled ? 'bg-gray-50 border-gray-200 opacity-50' : `${bg} ${border}`
      }`}
    >
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center ${
          disabled ? 'bg-gray-100 text-gray-400' : `${iconBg} ${iconColor}`
        }`}
      >
        {icon}
      </div>
      <div className="text-[var(--fs-md)] font-bold text-gray-900">{label}</div>
      <div className="text-[var(--fs-xs)] text-gray-500">{sub}</div>
      {badge && (
        <div className="absolute top-3 right-3 min-w-[22px] h-[22px] bg-red-500 text-white rounded-full text-[var(--fs-xs)] font-bold flex items-center justify-center px-1.5 font-mono">
          {badge}
        </div>
      )}
    </button>
  );
}
