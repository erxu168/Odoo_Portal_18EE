'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import CompanySelector from './CompanySelector';
import AppDrawer from './AppDrawer';
import { useTopBar } from './TopBarContext';

const HIDDEN_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password', '/shift-handover', '/kiosk', '/confirm-shift'];
// Wide routes render an edge-to-edge bar (content centered) instead of the
// phone-width column, so the bar doesn't float as a narrow box over wide content.
const WIDE_ROUTES = ['/shifts', '/hr'];

export default function AppTopBar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { hidden } = useTopBar();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  if (hidden || HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return null;
  }
  const isWide = WIDE_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  const dateStr = now
    ? `${now.toLocaleDateString('en-US', { weekday: 'short' })}, ${now.getDate()}. ${now.toLocaleDateString('en-US', { month: 'short' })}. ${now.getFullYear()}`
    : '';
  const timeStr = now ? now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

  const barContent = (
    <>
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
      <div className="flex items-center gap-3">
        <span className="text-[var(--fs-xs)] font-semibold text-white">{dateStr}</span>
        <span className="text-[var(--fs-xs)] text-white/60 font-mono">{timeStr}</span>
      </div>
      <CompanySelector />
    </>
  );

  return (
    <>
      {isWide ? (
        // Edge-to-edge blue bar, content centred to the module's width.
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#2563EB] border-b border-white/10">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-1.5">{barContent}</div>
        </div>
      ) : (
        // Below lg: centred phone-width box. At lg: edge-to-edge blue bar with the
        // content re-centred to the desktop container width.
        <div className="fixed top-0 left-0 right-0 z-50 max-w-lg mx-auto lg:max-w-none lg:mx-0 bg-[#2563EB] lg:border-b lg:border-white/10">
          <div className="max-w-lg lg:max-w-5xl xl:max-w-6xl mx-auto bg-[#2563EB] flex items-center justify-between px-4 py-1.5 border-b border-white/10 lg:border-b-0">{barContent}</div>
        </div>
      )}
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
