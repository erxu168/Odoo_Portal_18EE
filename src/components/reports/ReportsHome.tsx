'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface ReportTile {
  id: string;
  label: string;
  subtitle: string;
  href: string;
  minRole: 'manager' | 'admin';
  icon: React.ReactNode;
  color: string;
}

const TILES: ReportTile[] = [
  { id: 'dashboard', label: 'Dashboard', subtitle: 'Today, week, month, YTD', href: '/reports/dashboard', minRole: 'manager', color: 'text-blue-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
  { id: 'daily', label: 'Daily Breakdown', subtitle: 'Day-by-day with YoY', href: '/reports/daily', minRole: 'manager', color: 'text-cyan-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  { id: 'compare', label: 'Period Compare', subtitle: 'Week / month / year vs prev', href: '/reports/compare', minRole: 'manager', color: 'text-purple-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg> },
  { id: 'records', label: 'Records & Averages', subtitle: 'Best days, weeks, months', href: '/reports/records', minRole: 'manager', color: 'text-amber-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> },
  { id: 'pnl', label: 'P&L', subtitle: '12 ratios + full statement', href: '/reports/pnl', minRole: 'admin', color: 'text-green-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
  { id: 'operations', label: 'Operations', subtitle: 'Tips, cashiers, RevPASH', href: '/reports/operations', minRole: 'manager', color: 'text-red-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  { id: 'menu', label: 'Menu Intelligence', subtitle: 'Top sellers & category mix', href: '/reports/menu', minRole: 'manager', color: 'text-pink-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> },
  { id: 'locations', label: 'Locations', subtitle: 'Side-by-side comparison', href: '/reports/locations', minRole: 'manager', color: 'text-indigo-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
  { id: 'summary', label: 'Owner Report', subtitle: 'Monthly summary + alerts', href: '/reports/summary', minRole: 'admin', color: 'text-orange-600',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

export default function ReportsHome({ userRole }: { userRole: string }) {
  const router = useRouter();
  const myLevel = ROLE_LEVEL[userRole] || 1;
  const visibleTiles = TILES.filter(t => myLevel >= ROLE_LEVEL[t.minRole]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="REPORT BUILDER" title="Reports" subtitle="Analytics & insights" />

      <div className="px-5 pt-5">
        <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase mb-3">Choose a report</p>
        <div className="grid grid-cols-2 gap-3">
          {visibleTiles.map(tile => (
            <button
              key={tile.id}
              onClick={() => router.push(tile.href)}
              className="rounded-2xl border border-gray-200 bg-[#F1F3F5] p-4 flex flex-col items-center justify-center text-center aspect-square shadow-sm w-full active:scale-[0.97] transition-transform"
            >
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 mb-2 bg-white ${tile.color}`}>
                {tile.icon}
              </div>
              <div className="min-w-0">
                <div className="text-[var(--fs-md)] font-bold text-gray-900 leading-tight">{tile.label}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-1 leading-tight">{tile.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="text-center py-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-green-600 font-semibold">KRAWINGS</span> &middot; Report Builder v1
        </span>
      </div>
    </div>
  );
}
