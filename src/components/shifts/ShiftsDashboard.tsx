'use client';

import React, { useEffect, useState } from 'react';
import SortableTileGrid from '@/components/ui/SortableTileGrid';

/**
 * Shifts module dashboard — sortable tile grid (same pattern as MfgDashboard).
 * Staff tiles: Open Shifts / My Shifts / My Hours / Requests (badge).
 * Managers additionally get: Create Shift / Manage Shifts / Coverage /
 * Roster & Caps / Approvals (badge).
 * Badges are fetched by the page router (GET /api/shifts/summary) and passed in.
 * The manager-only settings gear lives in the AppHeader action (page.tsx).
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

export default function ShiftsDashboard({ isManager, badges, onNavigate }: ShiftsDashboardProps) {
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.user?.preferences?.shifts_tile_order) setSavedOrder(d.user.preferences.shifts_tile_order);
      })
      .catch(() => {});
  }, []);

  const staffTiles: Tile[] = [
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
      sublabel: 'Your schedule',
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
  ];

  const managerTiles: Tile[] = [
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

  const tiles: Tile[] = isManager ? [...staffTiles, ...managerTiles] : staffTiles;

  return (
    <div className="px-4 py-5">
      <SortableTileGrid
        items={tiles}
        getItemId={(t) => t.key}
        storageKey="shifts_tile_order"
        savedOrder={savedOrder}
        renderItem={(tile) => (
          <button
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
        )}
      />
    </div>
  );
}
