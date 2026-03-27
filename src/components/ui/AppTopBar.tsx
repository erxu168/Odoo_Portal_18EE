'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import CompanySelector from './CompanySelector';
import AppDrawer from './AppDrawer';
import { useTopBar } from './TopBarContext';

const HIDDEN_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password', '/hr'];

export default function AppTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { hidden } = useTopBar();
  const [user, setUser] = useState<{ name: string; avatar?: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); }).catch(() => {});
  }, []);

  if (hidden || HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return null;
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '';

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 max-w-lg mx-auto">
        <div className="bg-[#2563EB] flex items-center justify-between px-4 py-1.5 border-b border-white/10">
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
          <button
            onClick={() => router.push('/hr')}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform overflow-hidden"
            aria-label="My Profile"
          >
            {user?.avatar ? (
              <img src={`data:image/png;base64,${user.avatar}`} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-white/30" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center border-2 border-white/30">
                <span className="text-white text-[11px] font-bold">{initials}</span>
              </div>
            )}
          </button>
        </div>
      </div>
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
