'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';

/**
 * Reports home — the /reports landing (a tile launcher into the standalone report
 * pages under /reports/*). Replaces the old horizontally-scrolling tab shell
 * (ReportsApp). Manager+ only; P&L and Owner Report are admin-only.
 */

interface ReportTile {
  id: string;
  emoji: string;
  label: string;
  subtitle: string;
  href: string;
  minRole: 'manager' | 'admin';
}

const TILES: ReportTile[] = [
  { id: 'dashboard', emoji: '\u{1F4CA}', label: 'Dashboard', subtitle: 'Today, week, month, YTD', href: '/reports/dashboard', minRole: 'manager' },
  { id: 'daily', emoji: '\u{1F4C5}', label: 'Daily Breakdown', subtitle: 'Day-by-day with YoY', href: '/reports/daily', minRole: 'manager' },
  { id: 'compare', emoji: '\u{1F504}', label: 'Period Compare', subtitle: 'Week / month / year vs prev', href: '/reports/compare', minRole: 'manager' },
  { id: 'records', emoji: '\u{1F3C6}', label: 'Records & Averages', subtitle: 'Best days, weeks, months', href: '/reports/records', minRole: 'manager' },
  { id: 'operations', emoji: '⚙️', label: 'Operations', subtitle: 'Tips, cashiers, RevPASH', href: '/reports/operations', minRole: 'manager' },
  { id: 'menu', emoji: '\u{1F37D}\u{FE0F}', label: 'Menu Intelligence', subtitle: 'Top sellers & category mix', href: '/reports/menu', minRole: 'manager' },
  { id: 'locations', emoji: '\u{1F4CD}', label: 'Locations', subtitle: 'Side-by-side comparison', href: '/reports/locations', minRole: 'manager' },
  { id: 'pnl', emoji: '\u{1F4B6}', label: 'P&L', subtitle: '12 ratios + full statement', href: '/reports/pnl', minRole: 'admin' },
  { id: 'summary', emoji: '\u{1F4C4}', label: 'Owner Report', subtitle: 'Monthly summary + alerts', href: '/reports/summary', minRole: 'admin' },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

export default function ReportsHome() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const rl = d.user?.role || 'staff';
        if ((ROLE_LEVEL[rl] || 1) < ROLE_LEVEL.manager) { router.replace('/'); return; }
        setRole(rl);
      })
      .catch(() => router.replace('/'));
  }, [router]);

  if (!role) {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center pt-24">
        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const myLevel = ROLE_LEVEL[role] || 1;
  const visibleTiles = TILES.filter((t) => myLevel >= ROLE_LEVEL[t.minRole]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Reports" subtitle="Analytics & insights" />

      <div className="px-5 py-5">
        <ActionGrid<ReportTile>
          items={visibleTiles}
          getItemId={(t) => t.id}
          renderItem={(t) => (
            <ActionCard emoji={t.emoji} label={t.label} subtitle={t.subtitle} onClick={() => router.push(t.href)} />
          )}
        />
      </div>
    </div>
  );
}
