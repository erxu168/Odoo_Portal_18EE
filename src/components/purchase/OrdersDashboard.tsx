'use client';

import React, { useState, useEffect } from 'react';
import SortableTileGrid from '@/components/ui/SortableTileGrid';
import PurchaseAlerts from './PurchaseAlerts';

// ─────────────────────────────────────────────
// OrdersDashboard — 2×2 tile grid for Purchase landing
// Replaces horizontal tab bar (Order | Cart | Receive | History)
// ─────────────────────────────────────────────

type Tab = 'order' | 'cart' | 'receive' | 'history';

interface OrdersDashboardProps {
  cartItemCount: number;
  pendingDeliveryCount: number;
  onNavigate: (tab: Tab) => void;
  isManager: boolean;
  onManage: () => void;
  locationName: string;
  locationId: number;
}

// SVG icons — inline for zero dependencies
const PlaceOrderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const CartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
  </svg>
);

const ReceiveIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
    <polyline points="7.5 19.79 7.5 14.6 3 12" />
    <polyline points="21 12 16.5 14.6 16.5 19.79" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

interface TileConfig {
  id: Tab;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  badgeCount: number;
  badgeColor: string;
  color: string;
  iconBg: string;
  iconColor: string;
}

export default function OrdersDashboard({
  cartItemCount,
  pendingDeliveryCount,
  onNavigate,
  isManager,
  onManage,
  locationName,
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
    {
      id: 'order',
      label: 'Place Order',
      sublabel: 'Browse suppliers',
      icon: <PlaceOrderIcon />,
      badgeCount: 0,
      badgeColor: '',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
    },
    {
      id: 'cart',
      label: 'Cart',
      sublabel: cartItemCount > 0 ? `${cartItemCount} items` : 'No items yet',
      icon: <CartIcon />,
      badgeCount: cartItemCount,
      badgeColor: 'bg-green-600',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
    },
    {
      id: 'receive',
      label: 'Receive',
      sublabel: pendingDeliveryCount > 0 ? `${pendingDeliveryCount} pending` : 'No deliveries',
      icon: <ReceiveIcon />,
      badgeCount: pendingDeliveryCount,
      badgeColor: 'bg-blue-500',
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
    },
    {
      id: 'history',
      label: 'History',
      sublabel: 'Past orders',
      icon: <HistoryIcon />,
      badgeCount: 0,
      badgeColor: '',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-purple-100', iconColor: 'text-blue-600',
    },
  ];

  return (
    <div>
      {/* Order Alerts — holidays + supplier deadlines (TODO: wire up suppliers) */}
      <PurchaseAlerts suppliers={[]} />

      <div className="px-4 py-4">
        {/* Location context pill */}
        <div className="flex items-center justify-center mb-4">
          <span className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-wider uppercase">
            Ordering for {locationName}
          </span>
        </div>

        {/* 2×2 grid — drag-and-drop reorderable */}
        <SortableTileGrid
          items={tiles}
          getItemId={(t) => t.id}
          storageKey="purchase_tile_order"
          savedOrder={savedOrder}
          renderItem={(tile) => (
            <button
              onClick={() => onNavigate(tile.id)}
              className={`w-full relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
            >
              {tile.badgeCount > 0 && (
                <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold font-mono leading-5 text-center">
                  {tile.badgeCount}
                </span>
              )}
              <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[var(--fs-md)] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
            </button>
          )}
        />

        {/* Manager: Manage guides & settings */}
        {isManager && (
          <div className="text-center mt-5">
            <button
              onClick={onManage}
              className="inline-flex items-center gap-1.5 text-[var(--fs-xs)] font-semibold text-green-700 px-4 py-2.5 rounded-xl bg-green-50 border border-green-100 active:bg-green-100 transition-colors"
            >
              <SettingsIcon />
              Manage guides &amp; settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
