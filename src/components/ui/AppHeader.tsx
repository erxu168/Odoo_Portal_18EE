'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Unified header component for the entire Krawings Portal.
 * Replaces: Purchase dark header, Manufacturing white header, Inventory dark header.
 *
 * Design: Dark navy (#2563EB) with white text.
 * Layout: [back/home] [supertitle + title + subtitle] [action?] [home?]
 *
 * Props:
 *   supertitle - small uppercase label (e.g., "ORDER GUIDE", "KITCHEN PREP")
 *   title      - main heading (supplier name, product name, etc.)
 *   subtitle   - secondary info (location, reference, count)
 *   showBack   - show back arrow instead of home icon on left
 *   onBack     - callback for back arrow
 *   action     - optional right-side action button JSX
 */
interface AppHeaderProps {
  supertitle?: string;
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  action?: React.ReactNode;
}

const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const BackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
    <path d="M15 19l-7-7 7-7"/>
  </svg>
);

export default function AppHeader({ supertitle, title, subtitle, showBack, onBack, action }: AppHeaderProps) {
  const router = useRouter();

  function goHome() {
    router.push('/');
  }

  return (
    <div className="bg-[#2563EB] px-5 pt-12 pb-0 relative overflow-hidden">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative pb-3">
        <button
          onClick={showBack ? onBack : goHome}
          className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
        >
          {showBack ? <BackIcon /> : <HomeIcon />}
        </button>
        <div className="flex-1 min-w-0">
          {supertitle && (
            <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">
              {supertitle}
            </div>
          )}
          <h1 className="text-[18px] font-bold text-white leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-[12px] text-white/45 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
        {showBack && (
          <button
            onClick={goHome}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
            title="Dashboard"
          >
            <HomeIcon />
          </button>
        )}
      </div>
    </div>
  );
}
