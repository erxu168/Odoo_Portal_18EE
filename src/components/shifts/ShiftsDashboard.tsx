'use client';

import React from 'react';
import { ActionCard } from '@/components/ui/ActionCard';
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
 *   2. Grouped tile sections (navigation) — standard ui/ActionCard tiles:
 *        • My Shifts     — everyone: own schedule, hours, claims, cover requests, PIN
 *        • Plan & Manage — managers: build & run the schedule
 *        • Admin         — managers: team setup, records & compliance
 *
 * Badges (requests / approvals / unconfirmed) are fetched by the page router
 * (GET /api/shifts/summary) and passed in — red because each is an action needed.
 * The manager-only settings gear lives in the AppHeader action (page.tsx).
 */

interface ShiftsDashboardProps {
  companyId: number;
  isManager: boolean;
  badges: { requests: number; approvals: number; unconfirmed: number };
  onNavigate: (key: string) => void;
  onSettings: () => void;
  onHome: () => void;
}

interface Tile {
  key: string;
  emoji: string;
  label: string;
  sublabel: string;
  badge: number | null;
}

interface TileGroup {
  title: string;
  managerOnly: boolean;
  tiles: Tile[];
}

export default function ShiftsDashboard({ companyId, isManager, badges, onNavigate }: ShiftsDashboardProps) {
  const myShifts: Tile[] = [
    { key: 'open', emoji: '\u{1F64B}', label: 'Open Shifts', sublabel: 'Claim a free shift', badge: null },
    { key: 'mine', emoji: '\u{1F4C5}', label: 'My Shifts', sublabel: 'Your shifts', badge: null },
    { key: 'hours', emoji: '⏱️', label: 'My Hours', sublabel: 'Weekly totals', badge: null },
    { key: 'requests', emoji: '\u{1F504}', label: 'Requests', sublabel: 'Cover requests', badge: badges.requests > 0 ? badges.requests : null },
    { key: 'mypin', emoji: '\u{1F522}', label: 'Clock PIN', sublabel: 'Set your tablet PIN', badge: null },
  ];

  const planManage: Tile[] = [
    { key: 'create', emoji: '➕', label: 'Create Shift', sublabel: 'Add a new shift', badge: null },
    { key: 'manage', emoji: '\u{1F5D3}️', label: 'Manage Shifts', sublabel: 'Week planner', badge: null },
    { key: 'coverage', emoji: '\u{1F4CA}', label: 'Coverage', sublabel: 'Week at a glance', badge: null },
    { key: 'overview', emoji: '⚖️', label: 'Hours & Fairness', sublabel: 'Who’s over · weekends', badge: null },
    { key: 'busy', emoji: '\u{1F525}', label: 'Busy Times', sublabel: 'When we’re busiest', badge: null },
    { key: 'approvals', emoji: '✅', label: 'Approvals', sublabel: 'Covers & sick reports', badge: badges.approvals > 0 ? badges.approvals : null },
    { key: 'unconfirmed', emoji: '⏳', label: 'Not yet confirmed', sublabel: 'Who hasn’t confirmed', badge: badges.unconfirmed > 0 ? badges.unconfirmed : null },
  ];

  const admin: Tile[] = [
    { key: 'roster', emoji: '\u{1F465}', label: 'Roster & Caps', sublabel: 'Team, caps & skills', badge: null },
    { key: 'punctuality', emoji: '⏰', label: 'Punctuality', sublabel: 'Late · early · overtime', badge: null },
    { key: 'timesheet', emoji: '\u{1F9FE}', label: 'Timesheets', sublabel: '§17 records · export', badge: null },
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
              <ActionCard
                key={tile.key}
                emoji={tile.emoji}
                label={tile.label}
                subtitle={tile.sublabel}
                badge={tile.badge != null ? { value: tile.badge, tone: 'danger', ariaLabel: `${tile.label}: ${tile.badge}` } : undefined}
                onClick={() => onNavigate(tile.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
