'use client';

import React, { useState, useEffect } from 'react';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { ChevronRightIcon } from '@/components/ui/ChromeIcons';

// ─────────────────────────────────────────────
// OrdersDashboard — Purchase landing (design standard: KPI chips + white cards)
// ─────────────────────────────────────────────

type Tab = 'order' | 'cart' | 'receive' | 'history';

interface OrdersDashboardProps {
  cartItemCount: number;
  pendingDeliveryCount: number;
  awaitingApprovalCount: number;
  isManager: boolean;
  onNavigate: (tab: Tab) => void;
  onManageTemplates?: () => void;
  locationId: number;
}

interface TileConfig {
  id: Tab;
  label: string;
  sublabel: string;
  emoji: string;
  badge: number;
}

export default function OrdersDashboard({
  cartItemCount,
  pendingDeliveryCount,
  awaitingApprovalCount,
  isManager,
  onNavigate,
  onManageTemplates,
}: OrdersDashboardProps) {
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.user?.preferences?.purchase_tile_order) setSavedOrder(d.user.preferences.purchase_tile_order);
      })
      .catch(() => {});
  }, []);

  const tiles: TileConfig[] = [
    { id: 'order', label: 'Place Order', sublabel: 'Browse suppliers', emoji: '🛍️', badge: 0 },
    { id: 'cart', label: 'Cart', sublabel: cartItemCount > 0 ? `${cartItemCount} items` : 'No items yet', emoji: '🛒', badge: cartItemCount },
    { id: 'receive', label: 'Receive', sublabel: pendingDeliveryCount > 0 ? `${pendingDeliveryCount} pending` : 'No deliveries', emoji: '📥', badge: pendingDeliveryCount },
    { id: 'history', label: 'History', sublabel: 'Past orders', emoji: '🕐', badge: 0 },
  ];

  return (
    <div>
      <div className="px-4 py-4">
        <KpiRow columns={3} className="mb-4">
          <KpiChip value={cartItemCount} label="In cart" />
          <KpiChip value={pendingDeliveryCount} label="To receive" />
          <KpiChip value={awaitingApprovalCount} label="Approvals" />
        </KpiRow>

        {/* Approvals banner — surfaces submitted deliveries waiting for a manager (semantic warning) */}
        {awaitingApprovalCount > 0 && (
          <button
            onClick={() => onNavigate('receive')}
            className="w-full flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-4 text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-2xl" aria-hidden="true">⏳</div>
            <div className="flex-1 min-w-0">
              <div className="text-[var(--fs-md)] font-bold text-gray-900">
                {awaitingApprovalCount} {awaitingApprovalCount === 1 ? 'delivery' : 'deliveries'}{' '}
                {isManager ? 'need your approval' : 'awaiting approval'}
              </div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                {isManager ? 'Tap to review and approve' : 'A manager will review these'}
              </div>
            </div>
            <span className="text-amber-600 flex-shrink-0"><ChevronRightIcon size={18} /></span>
          </button>
        )}

        {/* Order Templates — reusable order lists (managers build/edit these) */}
        {isManager && onManageTemplates && (
          <button
            onClick={onManageTemplates}
            className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 mb-4 text-left active:scale-[0.98] transition-transform"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F1F3F5] flex items-center justify-center flex-shrink-0 text-2xl" aria-hidden="true">🗂️</div>
            <div className="flex-1 min-w-0">
              <div className="text-[var(--fs-md)] font-bold text-gray-900">Order Templates</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">Build &amp; edit your reusable order lists</div>
            </div>
            <span className="text-gray-300 flex-shrink-0"><ChevronRightIcon size={18} /></span>
          </button>
        )}

        <ActionGrid
          items={tiles}
          getItemId={(t) => t.id}
          sortable={{ storageKey: 'purchase_tile_order', savedOrder }}
          renderItem={(tile) => (
            <ActionCard
              emoji={tile.emoji}
              label={tile.label}
              subtitle={tile.sublabel}
              onClick={() => onNavigate(tile.id)}
              badge={tile.badge > 0 ? { value: tile.badge, ariaLabel: `${tile.badge}` } : undefined}
            />
          )}
        />
      </div>
    </div>
  );
}
