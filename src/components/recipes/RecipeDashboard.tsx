'use client';

import React, { useState, useEffect } from 'react';

interface Props {
  userRole: string;
  onNavigate: (screen: string) => void;
  onHome: () => void;
}

const TILES = [
  {
    id: 'cooking-guide',
    label: 'Cooking Guide',
    sub: 'SSAM menu dishes',
    icon: '\ud83c\udf73',
    color: 'bg-orange-50 border-orange-200',
    iconBg: 'bg-orange-100',
    minRole: 'staff',
  },
  {
    id: 'production-guide',
    label: 'Production Guide',
    sub: 'WAJ sauces & prep',
    icon: '\ud83c\udfed',
    color: 'bg-purple-50 border-purple-200',
    iconBg: 'bg-purple-100',
    minRole: 'staff',
  },
  {
    id: 'record',
    label: 'Record',
    sub: 'Create guides',
    icon: '\u23fa',
    color: 'bg-red-50 border-red-200',
    iconBg: 'bg-red-100',
    minRole: 'staff',
  },
  {
    id: 'edit',
    label: 'Edit Recipes',
    sub: 'Create & modify',
    icon: '\ud83d\udcdd',
    color: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
    minRole: 'staff',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    sub: 'Review changes',
    icon: '\u2713',
    color: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    minRole: 'manager',
    badge: true,
  },
  {
    id: 'stats',
    label: 'Stats',
    sub: 'Cook history',
    icon: '\ud83d\udcca',
    color: 'bg-teal-50 border-teal-200',
    iconBg: 'bg-teal-100',
    minRole: 'staff',
  },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

export default function RecipeDashboard({ userRole, onNavigate, onHome }: Props) {
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recipeCount, setRecipeCount] = useState({ cooking: 0, production: 0 });
  const [syncPending, setSyncPending] = useState(0);

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
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-6 rounded-b-[28px] relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[22px] font-bold text-white">Recipe Guide</h1>
            <p className="text-[12px] text-white/50 mt-0.5">SSAM Korean BBQ</p>
          </div>
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
        <div className="grid grid-cols-2 gap-3">
          {visibleTiles.map(tile => (
            <button
              key={tile.id}
              onClick={() => onNavigate(tile.id)}
              className={`relative p-4 rounded-2xl border ${tile.color} text-left active:scale-[0.97] transition-transform shadow-sm`}
            >
              {tile.badge && pendingApprovals > 0 && (
                <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold font-mono leading-[22px] text-center">
                  {pendingApprovals}
                </span>
              )}
              <div className={`w-11 h-11 rounded-xl ${tile.iconBg} flex items-center justify-center text-xl mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{getSub(tile)}</div>
            </button>
          ))}
        </div>
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
          <span className="text-green-600 font-semibold">KRAWINGS</span> Recipe Guide
        </span>
      </div>
    </div>
  );
}
