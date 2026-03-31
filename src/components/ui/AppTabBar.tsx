'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTopBar } from './TopBarContext';

const TABS = [
  {
    id: 'home',
    label: 'Home',
    href: '/',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#16A34A' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: 'manufacturing',
    label: 'Prep',
    href: '/manufacturing',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#16A34A' : '#9CA3AF'} strokeWidth="2">
        <path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/>
      </svg>
    ),
  },
  {
    id: 'purchase',
    label: 'Orders',
    href: '/purchase',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#16A34A' : '#9CA3AF'} strokeWidth="2">
        <circle cx="9" cy="21" r="1"/>
        <circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
      </svg>
    ),
  },
  {
    id: 'inventory',
    label: 'Stock',
    href: '/inventory',
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#16A34A' : '#9CA3AF'} strokeWidth="2">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
      </svg>
    ),
  },
];

/**
 * Bottom tab bar. Hidden on auth pages and full-screen module pages (recipes, etc.)
 */

const HIDDEN_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password', '/hr'];

export default function AppTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { hidden } = useTopBar();

  if (hidden || HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return null;
  }

  function isActive(tab: typeof TABS[0]) {
    if (tab.href === '/') return pathname === '/';
    return pathname.startsWith(tab.href);
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 max-w-lg mx-auto">
      <div className="flex h-16">
        {TABS.map(tab => {
          const active = isActive(tab);
          return (
            <button
              key={tab.id}
              onClick={() => router.push(tab.href)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-green-700' : 'text-gray-400'
              }`}
            >
              {tab.icon(active)}
              <span className={`text-[12px] font-bold ${active ? 'text-green-700' : 'text-gray-400'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
