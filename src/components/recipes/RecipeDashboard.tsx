'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { useCompany } from '@/lib/company-context';

interface Props {
  userRole: string;
  onNavigate: (screen: string) => void;
  onHome?: () => void;
  onSettings?: () => void;
  scope?: 'cooking' | 'production';
}

const TILES = [
  { id: 'cooking-guide', label: 'Cooking Guide', sub: 'SSAM menu dishes', emoji: '📖', minRole: 'staff' },
  { id: 'production-guide', label: 'Production Guide', sub: 'WAJ sauces & prep', emoji: '🥫', minRole: 'staff' },
  { id: 'record', label: 'Record', sub: 'Create guides', emoji: '⏺️', minRole: 'staff' },
  { id: 'edit', label: 'Edit Recipes', sub: 'Create & modify', emoji: '✏️', minRole: 'staff' },
  { id: 'approvals', label: 'Approvals', sub: 'Review changes', emoji: '✅', minRole: 'manager', badge: true },
  { id: 'stats', label: 'Stats', sub: 'Cook history', emoji: '📊', minRole: 'staff' },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

export default function RecipeDashboard({ userRole, onNavigate, onHome, onSettings, scope = 'cooking' }: Props) {
  const { companyName, companyId } = useCompany();
  const isProduction = scope === 'production';
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recipeCount, setRecipeCount] = useState({ cooking: 0, production: 0 });
  const [syncPending, setSyncPending] = useState(0);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch recipe counts (scoped to the active restaurant)
        const res = await fetch(`/api/recipes${companyId ? `?company_id=${companyId}` : ''}`);
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
  }, [companyId]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.preferences?.recipes_tile_order) setSavedOrder(d.user.preferences.recipes_tile_order);
    }).catch(() => {});
  }, []);

  const myLevel = ROLE_LEVEL[userRole] || 1;
  const visibleTiles = TILES
    .filter(t => myLevel >= (ROLE_LEVEL[t.minRole] || 1))
    // Chef Guide shows the cooking browse; Production Guide shows the production browse. Never both.
    .filter(t => {
      if (t.id === 'cooking-guide') return !isProduction;
      if (t.id === 'production-guide') return isProduction;
      return true;
    });

  function getSub(tile: typeof TILES[0]): string {
    if (tile.id === 'cooking-guide') return `${recipeCount.cooking} published recipes`;
    if (tile.id === 'production-guide') return `${recipeCount.production} published recipes`;
    return tile.sub;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <AppHeader
        supertitle={isProduction ? 'PRODUCTION GUIDE' : 'CHEF GUIDE'}
        title={isProduction ? 'Production Guide' : 'Chef Guide'}
        subtitle={companyName || (isProduction ? 'Production Guide' : 'Chef Guide')}
        action={onSettings ? (
          <button onClick={onSettings}
            className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center active:bg-white/25"
            aria-label="Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
        ) : undefined}
      />

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

      {/* Stat chips — approvals are a manager-only concern */}
      <div className="px-5 pt-4">
        <KpiRow columns={myLevel >= ROLE_LEVEL.manager ? 3 : 2}>
          <KpiChip value={recipeCount.cooking} label="Dishes" />
          <KpiChip value={recipeCount.production} label="Sauces" />
          {myLevel >= ROLE_LEVEL.manager && <KpiChip value={pendingApprovals} label="Approvals" />}
        </KpiRow>
      </div>

      {/* Tile grid */}
      <div className="px-5 pt-4">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3">What are we making?</p>
        <ActionGrid
          items={visibleTiles}
          getItemId={(tile) => tile.id}
          sortable={{ storageKey: 'recipes_tile_order', savedOrder }}
          renderItem={(tile) => (
            <ActionCard
              emoji={tile.emoji}
              label={tile.label}
              subtitle={getSub(tile)}
              onClick={() => onNavigate(tile.id)}
              badge={tile.badge && pendingApprovals > 0 ? { value: pendingApprovals, ariaLabel: `${pendingApprovals} pending` } : undefined}
            />
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
