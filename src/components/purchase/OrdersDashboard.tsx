'use client';

import React from 'react';

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
}

// SVG icons — inline for zero dependencies
const PlaceOrderIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const CartIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
  </svg>
);

const ReceiveIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
    <polyline points="7.5 19.79 7.5 14.6 3 12" />
    <polyline points="21 12 16.5 14.6 16.5 19.79" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
}

export default function OrdersDashboard({
  cartItemCount,
  pendingDeliveryCount,
  onNavigate,
  isManager,
  onManage,
  locationName,
}: OrdersDashboardProps) {
  const tiles: TileConfig[] = [
    {
      id: 'order',
      label: 'Place Order',
      sublabel: 'Browse suppliers',
      icon: <PlaceOrderIcon />,
      badgeCount: 0,
      badgeColor: '',
    },
    {
      id: 'cart',
      label: 'Cart',
      sublabel: cartItemCount > 0 ? `${cartItemCount} items` : 'No items yet',
      icon: <CartIcon />,
      badgeCount: cartItemCount,
      badgeColor: 'bg-green-600',
    },
    {
      id: 'receive',
      label: 'Receive',
      sublabel: pendingDeliveryCount > 0 ? `${pendingDeliveryCount} pending` : 'No deliveries',
      icon: <ReceiveIcon />,
      badgeCount: pendingDeliveryCount,
      badgeColor: 'bg-blue-500',
    },
    {
      id: 'history',
      label: 'History',
      sublabel: 'Past orders',
      icon: <HistoryIcon />,
      badgeCount: 0,
      badgeColor: '',
    },
  ];

  return (
    <div className="px-4 py-4">
      {/* Location context pill */}
      <div className="flex items-center justify-center mb-4">
        <span className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase">
          Ordering for {locationName}
        </span>
      </div>

      {/* 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            onClick={() => onNavigate(tile.id)}
            className="relative flex flex-col items-center justify-center gap-2 py-7 px-3 bg-white border border-gray-200 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] active:scale-[0.96] transition-transform"
          >
            {/* Badge */}
            {tile.badgeCount > 0 && (
              <span
                className={`absolute top-2.5 right-2.5 min-w-[22px] h-[22px] px-1.5 rounded-full text-white text-[12px] font-bold font-mono leading-[22px] text-center ${tile.badgeColor}`}
              >
                {tile.badgeCount}
              </span>
            )}

            {/* Icon container */}
            <div className="w-14 h-14 rounded-[16px] bg-gray-100 flex items-center justify-center text-blue-600">
              {tile.icon}
            </div>

            {/* Label */}
            <div className="text-center">
              <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">{tile.sublabel}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Manager: Manage guides & settings */}
      {isManager && (
        <div className="text-center mt-5">
          <button
            onClick={onManage}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-green-700 px-4 py-2.5 rounded-xl bg-green-50 border border-green-100 active:bg-green-100 transition-colors"
          >
            <SettingsIcon />
            Manage guides &amp; settings
          </button>
        </div>
      )}
    </div>
  );
}
