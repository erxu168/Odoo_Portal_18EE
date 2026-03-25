'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import CompanySelector from './CompanySelector';
import AppDrawer from './AppDrawer';

/**
 * Thin persistent top bar with hamburger menu and company selector.
 * Hidden on auth pages and full-screen module pages (recipes, etc.)
 */

const HIDDEN_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

export default function AppTopBar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return null;
  }

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 max-w-lg mx-auto">
        <div className="bg-[#1A1F2E] flex items-center justify-between px-4 py-1.5 border-b border-white/10">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg active:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <CompanySelector />
        </div>
      </div>
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
