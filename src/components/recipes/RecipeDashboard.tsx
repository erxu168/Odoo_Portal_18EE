'use client';

import React, { useState, useEffect } from 'react';
import SortableTileGrid from '@/components/ui/SortableTileGrid';

interface Props {
  userRole: string;
  onNavigate: (screen: string) => void;
  onHome?: () => void;
  onSettings?: () => void;
}

const TILES = [
  {
    id: 'cooking-guide',
    label: 'Cooking Guide',
    sub: 'SSAM menu dishes',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></svg>,
    color: 'bg-orange-50 border-orange-200',
    iconBg: 'bg-orange-100',
    minRole: 'staff',
  },
  {
    id: 'production-guide',
    label: 'Production Guide',
    sub: 'WAJ sauces & prep',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>,
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-purple-100',
    minRole: 'staff',
  },
  {
    id: 'record',
    label: 'Record',
    sub: 'Create guides',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>,
    color: 'bg-red-50 border-red-200',
    iconBg: 'bg-red-100',
    minRole: 'staff',
  },
  {
    id: 'edit',
    label: 'Edit Recipes',
    sub: 'Create & modify',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
    minRole: 'staff',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    sub: 'Review changes',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
    color: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    minRole: 'manager',
    badge: true,
  },
  {
    id: 'stats',
    label: 'Stats',
    sub: 'Cook history',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>,
    color: 'bg-teal-50 border-teal-200',
    iconBg: 'bg-teal-100',
    minRole: 'staff',
  },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

export default function RecipeDashboard({ userRole, onNavigate, onHome, onSettings }: Props) {
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recipeCount, setRecipeCount] = useState({ cooking: 0, production: 0 });
  const [syncPending, setSyncPending] = useState(0);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch recipe counts
        const res = await fetch('/api/recipes');
        if (res.ok) {
          const data = await res.json();
          setRecipeCount({
            cooking: (data.cooking_guide || []).length,
            production: (data.production_guide || []).length,
          });
        }
      } catch (e) {
        console.error('Failed to fetch recipe stats:', e);
      }
      try {
        // Fetch pending approvals
        const res2 = await fetch('/api/recipes/versions?status=review');
        if (res2.ok) {
          const data2 = await res2.json();
          setPendingApprovals((data2.versions || []).length);
        }
      } catch (e) {
        console.error('Failed to fetch approval count:', e);
      }
      try {
        // Fetch sync status
        const res3 = await fetch('/api/recipes/sync');
        if (res3.ok) {
          const data3 = await res3.json();
          setSyncPending(data3.pending_count || 0);
        }
      } catch (e) {
        // Sync endpoint may not be available
      }
    }
    fetchStats();
  }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.preferences?.recipes_tile_order) setSavedOrder(d.user.preferences.recipes_tile_order);
    }).catch(() => {});
  }, []);

  const myLevel = ROLE_LEVEL[userRole] || 1;
  const visibleTiles = TILES.filter(t => myLevel >= (ROLE_LEVEL[t.minRole] || 1));

  function getSub(tile: typeof TILES[0]): string {
    if (tile.id === 'cooking-guide') return `${recipeCount.cooking} published recipes`;
    if (tile.id === 'production-guide') return `${recipeCount.production} published recipes`;
    return tile.sub;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px] relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome}
            className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Chef Guide</h1>
            <p className="text-[12px] text-zinc-400 mt-0.5">SSAM Korean BBQ</p>
          </div>
          {onSettings && (
            <button onClick={onSettings}
              className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Sync banner */}
      {syncPending > 0 && (
        <div className="mx-5 mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 text-sm font-bold font-mono">{syncPending}</div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-amber-900">Items pending sync</div>
            <div className="text-[11px] text-amber-700">Will sync to Odoo when connected</div>
          </div>
        </div>
      )}

      {/* Tile grid */}
      <div className="px-5 pt-5">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">What are we making?</p>
        <SortableTileGrid
          items={visibleTiles}
          getItemId={(tile) => tile.id}
          storageKey="recipes_tile_order"
          savedOrder={savedOrder}
          renderItem={(tile) => (
            <button
              onClick={() => onNavigate(tile.id)}
              className={`w-full relative p-4 rounded-2xl border ${tile.color} text-left active:scale-[0.97] transition-transform shadow-sm`}
            >
              {tile.badge && pendingApprovals > 0 && (
                <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold font-mono leading-[22px] text-center">
                  {pendingApprovals}
                </span>
              )}
              <div className={`w-11 h-11 rounded-xl ${tile.iconBg} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{getSub(tile)}</div>
            </button>
          )}
        />
      </div>

      {/* Recent activity placeholder */}
      <div className="px-5 pt-6">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">Recent activity</p>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-[13px] text-gray-400">Recipe activity will appear here once guides are recorded and approved.</p>
        </div>
      </div>

      <div className="text-center py-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-green-600 font-semibold">KRAWINGS</span> Chef Guide
        </span>
      </div>
    </div>
  );
}
