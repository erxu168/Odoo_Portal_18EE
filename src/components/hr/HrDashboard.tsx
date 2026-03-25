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
    <div className="min-h-screen bg-[#f8faf9]">
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
              <div className="text-[13px] text-amber-800">
                Your onboarding is <strong>incomplete</strong> ({pct}%). Tap
                &quot;Onboarding&quot; to continue.
              </div>
            </div>
          )}

          {/* Staff tiles */}
          <div className="grid grid-cols-2 gap-3 p-5">
            <DashTile
              icon={'\u{1F464}'}
              iconBg="bg-green-50"
              label="My Profile"
              sub="View & edit your info"
              onClick={() => onNavigate('profile')}
            />
            {!isComplete ? (
              <DashTile
                icon={'\u{1F4CB}'}
                iconBg="bg-amber-50"
                label="Onboarding"
                sub={`Step ${getStep(employee)} of 6`}
                badge="!"
                onClick={() => onNavigate('onboarding')}
              />
            ) : (
              <DashTile
                icon={'\u2705'}
                iconBg="bg-green-50"
                label="Onboarding"
                sub="Complete"
                onClick={() => onNavigate('onboarding')}
              />
            )}
            <DashTile
              icon={'\u{1F4C4}'}
              iconBg="bg-blue-50"
              label="My Documents"
              sub={`${uploadedDocs} of ${requiredDocs} uploaded`}
              onClick={() => onNavigate('documents')}
            />
            <DashTile
              icon={'\u2753'}
              iconBg="bg-green-50"
              label="Help"
              sub="Guides for new staff"
              onClick={() => {}}
            />
          </div>

          {/* Manager section */}
          {isManager && (
            <>
              <div className="px-5 pt-2 pb-1">
                <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400">
                  Manager Tools
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                <DashTile
                  icon={'\u{1F465}'}
                  iconBg="bg-green-50"
                  label="Employees"
                  sub="View all staff"
                  onClick={() => onNavigate('employees')}
                />
                <DashTile
                  icon={'\u{1F4E5}'}
                  iconBg="bg-blue-50"
                  label="DATEV Export"
                  sub="Personalfragebogen"
                  onClick={() => {}}
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
  iconBg: string;
  label: string;
  sub: string;
  badge?: string;
  onClick: () => void;
}

function DashTile({ icon, iconBg, label, sub, badge, onClick }: TileProps) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl p-4 flex flex-col items-start gap-2 border border-gray-200 text-left relative active:shadow-lg transition-shadow"
    >
      <div
        className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center`}
      >
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-gray-900">{label}</div>
      <div className="text-[12px] text-gray-500">{sub}</div>
      {badge && (
        <div className="absolute top-3 right-3 min-w-[22px] h-[22px] bg-red-500 text-white rounded-full text-[11px] font-bold flex items-center justify-center px-1.5 font-mono">
          {badge}
        </div>
      )}
    </button>
  );
}
