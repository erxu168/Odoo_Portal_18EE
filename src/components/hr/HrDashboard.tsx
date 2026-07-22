'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import MyLifecycleTasks from '@/components/hr/MyLifecycleTasks';
import type { EmployeeData } from '@/types/hr';
import { calculateOnboardingPercent } from '@/types/hr';

interface Props {
  onNavigate: (tile: string) => void;
  onHome: () => void;
}

interface TileData {
  id: string;
  emoji: string;
  label: string;
  sub: string;
  badge?: string;
  badgeTone?: 'count' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
}

export default function HrDashboard({ onNavigate, onHome }: Props) {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);
  const [role, setRole] = useState<string>('staff');
  const [allowedModules, setAllowedModules] = useState<string[] | null>(null);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [savedManagerOrder, setSavedManagerOrder] = useState<string[] | null>(null);
  const [attentionCount, setAttentionCount] = useState(0);

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
        // Managers: load the "needs attention" count for the tile badge.
        if (mgrRes.ok) {
          try {
            const ov = await (await fetch('/api/hr/overview')).json();
            if (!ov.error) {
              setAttentionCount(
                (ov.missingDocs?.length || 0) + (ov.expiring?.length || 0) +
                (ov.contractsEnding?.length || 0) + (ov.sofortmeldung?.length || 0) +
                (ov.overdueChecklistTasks || 0),
              );
            }
          } catch { /* badge is best-effort */ }
        }
      } catch (_e: unknown) {
        console.error('Failed to load HR dashboard');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.role) setRole(d.user.role);
      if (Array.isArray(d.user?.modules)) setAllowedModules(d.user.modules);
      if (d.user?.preferences?.hr_tile_order) setSavedOrder(d.user.preferences.hr_tile_order);
      if (d.user?.preferences?.hr_manager_tile_order) setSavedManagerOrder(d.user.preferences.hr_manager_tile_order);
    }).catch(() => {});
  }, []);

  const pct = employee ? calculateOnboardingPercent(employee) : 0;
  const isComplete = employee?.kw_onboarding_status === 'complete';
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

  // Termination lives inside HR now (admin-only by default, respects per-user module access).
  const canSeeTermination = allowedModules == null ? role === 'admin' : allowedModules.includes('termination');

  // Personal tiles (every user).
  const staffTiles: TileData[] = [
    { id: 'profile', emoji: '\u{1F464}', label: 'My Profile', sub: 'View & edit your info', onClick: () => onNavigate('profile') },
    isComplete
      ? { id: 'onboarding', emoji: '\u{1F4CB}', label: 'Onboarding', sub: 'Complete', onClick: () => onNavigate('onboarding') }
      : { id: 'onboarding', emoji: '\u{1F4CB}', label: 'Onboarding', sub: `Step ${getStep(employee)} of 6`, badge: '!', badgeTone: 'danger', onClick: () => onNavigate('onboarding') },
    { id: 'documents', emoji: '\u{1F4C4}', label: 'My Documents', sub: `${uploadedDocs} of ${requiredDocs} uploaded`, onClick: () => onNavigate('documents') },
    { id: 'help', emoji: '❓', label: 'Help', sub: 'Coming soon', disabled: true },
  ];

  // Manager/admin tools (revealed below the personal tiles).
  const managerTiles: TileData[] = [
    { id: 'overview', emoji: '⚠️', label: 'Needs attention', sub: 'Docs, expiries & contracts', badge: attentionCount > 0 ? String(attentionCount) : undefined, badgeTone: 'danger', onClick: () => onNavigate('overview') },
    { id: 'employees', emoji: '\u{1F465}', label: 'Employees', sub: 'View all staff', onClick: () => onNavigate('employees') },
    { id: 'departments', emoji: '\u{1F3E2}', label: 'Departments & Roles', sub: 'Organise your teams', onClick: () => onNavigate('departments') },
    { id: 'timeoff', emoji: '\u{1F334}', label: 'Time Off', sub: 'Review & book leave', onClick: () => onNavigate('timeoff') },
    ...(role === 'admin' ? [{ id: 'checklist-setup', emoji: '⚙️', label: 'Checklist Setup', sub: 'Hire, promote & leave', onClick: () => onNavigate('checklist-setup') } as TileData] : []),
    ...(canSeeTermination ? [{ id: 'termination', emoji: '\u{1F6AA}', label: 'Termination', sub: 'Letters & offboarding', onClick: () => onNavigate('termination') } as TileData] : []),
    { id: 'datev-export', emoji: '\u{1F4E4}', label: 'DATEV Export', sub: 'Coming soon', disabled: true },
  ];

  const renderTile = (tile: TileData) => (
    <ActionCard
      emoji={tile.emoji}
      label={tile.label}
      subtitle={tile.sub}
      disabled={tile.disabled}
      badge={tile.badge ? { value: tile.badge, tone: tile.badgeTone, ariaLabel: `${tile.label}: ${tile.badge}` } : undefined}
      onClick={tile.onClick}
    />
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
      <AppHeader title="HR & Onboarding" subtitle="Team, onboarding & leave" />

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

          {/* The employee's own lifecycle tasks (renders nothing when empty) */}
          <MyLifecycleTasks />

          {/* Stat chips — personal progress, plus the manager attention count. */}
          <div className="px-5 pt-4">
            <KpiRow columns={isManager ? 3 : 2}>
              <KpiChip value={`${pct}%`} label="Onboarding" />
              <KpiChip value={`${uploadedDocs}/${requiredDocs}`} label="Documents" />
              {isManager && (
                <KpiChip value={attentionCount} label="Needs attn" tone={attentionCount > 0 ? 'danger' : 'default'} />
              )}
            </KpiRow>
          </div>

          {/* Staff tiles */}
          <div className="p-5">
            <ActionGrid<TileData>
              items={staffTiles}
              getItemId={(t) => t.id}
              sortable={{ storageKey: 'hr_tile_order', savedOrder }}
              renderItem={renderTile}
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
              <div className="px-5 pb-5">
                <ActionGrid<TileData>
                  items={managerTiles}
                  getItemId={(t) => t.id}
                  sortable={{ storageKey: 'hr_manager_tile_order', savedOrder: savedManagerOrder }}
                  renderItem={renderTile}
                />
              </div>
            </>
          )}
        </>
      )}
      </div>
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
