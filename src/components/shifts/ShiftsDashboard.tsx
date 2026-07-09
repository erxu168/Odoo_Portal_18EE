'use client';

import React from 'react';
import ManagerKpiStack from '@/components/shifts/ManagerKpiStack';
import StaffKpiStack from '@/components/shifts/StaffKpiStack';

/**
 * Planning module dashboard.
 *
 * Layout (top → bottom):
 *   1. Role-aware KPI stack — different jobs for different people:
 *        • Managers → ManagerKpiStack: on-shift-now, week coverage, team hours &
 *          cost, punctuality hot-spots (an ops board: now → today → week ahead).
 *        • Staff    → StaffKpiStack: next shift, hours this week/month vs their
 *          contracted target or Minijob cap, open shifts, requests, on-time %.
 *   2. Grouped tile sections (navigation):
 *        • My Shifts     — everyone: own schedule, hours, claims, cover requests, PIN
 *        • Plan & Manage — managers: build & run the schedule
 *        • Admin         — managers: team setup, records & compliance
 *
 * Badges (requests / approvals) are fetched by the page router
 * (GET /api/shifts/summary) and passed in. The manager-only settings gear lives
 * in the AppHeader action (page.tsx).
 */

interface ShiftsDashboardProps {
  companyId: number;
  isManager: boolean;
  badges: { requests: number; approvals: number };
  onNavigate: (key: string) => void;
  onSettings: () => void;
  onHome: () => void;
}

interface Tile {
  key: string;
  label: string;
  sublabel: string;
  color: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  badge: number | null;
}

interface TileGroup {
  title: string;
  managerOnly: boolean;
  tiles: Tile[];
}

export default function ShiftsDashboard({ companyId, isManager, badges, onNavigate }: ShiftsDashboardProps) {
  const myShifts: Tile[] = [
    {
      key: 'open',
      label: 'Open Shifts',
      sublabel: 'Claim a free shift',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <line x1="12" y1="13" x2="12" y2="19"/>
          <line x1="9" y1="16" x2="15" y2="16"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'mine',
      label: 'My Shifts',
      sublabel: 'Your shifts',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <path d="M9 16l2 2 4-4"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'hours',
      label: 'My Hours',
      sublabel: 'Weekly totals',
      color: 'bg-purple-50 border-purple-200', iconBg: 'bg-purple-100', iconColor: 'text-purple-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15 14"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'requests',
      label: 'Requests',
      sublabel: 'Cover requests',
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 014-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 01-4 4H3"/>
        </svg>
      ),
      badge: badges.requests > 0 ? badges.requests : null,
    },
    {
      key: 'mypin',
      label: 'Clock PIN',
      sublabel: 'Set your tablet PIN',
      color: 'bg-slate-50 border-slate-200', iconBg: 'bg-slate-100', iconColor: 'text-slate-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      ),
      badge: null,
    },
  ];

  const planManage: Tile[] = [
    {
      key: 'create',
      label: 'Create Shift',
      sublabel: 'Add a new shift',
      color: 'bg-orange-50 border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'manage',
      label: 'Manage Shifts',
      sublabel: 'Week planner',
      color: 'bg-cyan-50 border-cyan-200', iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'coverage',
      label: 'Coverage',
      sublabel: 'Week at a glance',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'overview',
      label: 'Hours & Fairness',
      sublabel: 'Who’s over · weekends',
      color: 'bg-purple-50 border-purple-200', iconBg: 'bg-purple-100', iconColor: 'text-purple-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'busy',
      label: 'Busy Times',
      sublabel: 'When we’re busiest',
      color: 'bg-orange-50 border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'approvals',
      label: 'Approvals',
      sublabel: 'Covers & sick reports',
      color: 'bg-red-50 border-red-200', iconBg: 'bg-red-100', iconColor: 'text-red-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
      ),
      badge: badges.approvals > 0 ? badges.approvals : null,
    },
  ];

  const admin: Tile[] = [
    {
      key: 'roster',
      label: 'Roster & Caps',
      sublabel: 'Team, caps & skills',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/>
          <path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'punctuality',
      label: 'Punctuality',
      sublabel: 'Late · early · overtime',
      color: 'bg-rose-50 border-rose-200', iconBg: 'bg-rose-100', iconColor: 'text-rose-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="13" r="8"/>
          <path d="M12 9v4l2 2"/>
          <path d="M5 3L2 6"/>
          <path d="M22 6l-3-3"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'timesheet',
      label: 'Timesheets',
      sublabel: '§17 records · export',
      color: 'bg-indigo-50 border-indigo-200', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="16" y2="17"/>
        </svg>
      ),
      badge: null,
    },
  ];

  const groups: TileGroup[] = [
    { title: 'My Shifts', managerOnly: false, tiles: myShifts },
    { title: 'Plan & Manage', managerOnly: true, tiles: planManage },
    { title: 'Admin', managerOnly: true, tiles: admin },
  ];

  const visibleGroups = groups.filter((g) => !g.managerOnly || isManager);

  return (
    <div className="px-4 py-4 flex flex-col gap-5 max-w-5xl mx-auto w-full">
      {isManager ? (
        <ManagerKpiStack companyId={companyId} onNavigate={onNavigate} />
      ) : (
        <StaffKpiStack companyId={companyId} onNavigate={onNavigate} />
      )}

      {visibleGroups.map((group) => (
        <section key={group.title}>
          <h2 className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-widest uppercase pb-2 pl-0.5">
            {group.title}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {group.tiles.map((tile) => (
              <button
                key={tile.key}
                onClick={() => onNavigate(tile.key)}
                className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left w-full active:scale-[0.97] transition-transform`}
              >
                <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                  {tile.icon}
                </div>
                <div className="text-[var(--fs-md)] font-bold text-gray-900">{tile.label}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
                {tile.badge !== null && (
                  <span className="absolute top-3 right-3 min-w-[22px] h-6 px-2 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold flex items-center justify-center">
                    {tile.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
