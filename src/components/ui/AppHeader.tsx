'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { HomeIcon, BackIcon } from './ChromeIcons';

/**
 * Unified header component for the entire Krawings Portal — the design standard's
 * header card. Blue (#2563EB) with white text, rounded bottom corners.
 * Layout: [back/home] [supertitle + title + subtitle] [action?] [home?]
 *
 * Props:
 *   supertitle - small uppercase label (e.g., "ORDER GUIDE", "KITCHEN PREP")
 *   title      - main heading (supplier name, product name, etc.)
 *   subtitle   - secondary info (location, reference, count)
 *   showBack   - show back arrow instead of home icon on left
 *   onBack     - callback for back arrow
 *   action     - optional right-side action button JSX (e.g. <CompanyPill />)
 */
interface AppHeaderProps {
  supertitle?: string;
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  backHref?: string;   // declarative UP-the-hierarchy back target (works from server components)
  root?: boolean;   // a genuine top-level screen with nowhere to return to → home-only (no Back arrow)
  action?: React.ReactNode;
}

export default function AppHeader({ supertitle, title, subtitle, showBack, onBack, backHref, root, action }: AppHeaderProps) {
  const router = useRouter();

  function goHome() {
    router.push('/');
  }

  // Back is the DEFAULT: every screen you navigate INTO shows a Back arrow (+ Home on the
  // right). An explicit `showBack` prop still wins (so all existing callers are unchanged);
  // a true top-level screen passes `root` to stay home-only. A missing `onBack` falls back
  // to a guarded history-back so nobody has to wire it up.
  const showBackButton = showBack ?? !root;
  const handleBack = onBack ?? (() => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  });

  return (
    <div className="bg-[#2563EB] px-5 pt-12 lg:pt-8 pb-0 relative overflow-hidden rounded-b-[28px]">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative pb-3">
        <button
          onClick={showBackButton ? handleBack : goHome}
          aria-label={showBackButton ? 'Back' : 'Home'}
          className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white active:bg-white/20 transition-colors"
        >
          {showBackButton ? <BackIcon size={22} /> : <HomeIcon size={22} />}
        </button>
        <div className="flex-1 min-w-0">
          {supertitle && (
            <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/50 mb-0.5">
              {supertitle}
            </div>
          )}
          <h1 className="text-[20px] lg:text-[24px] font-bold text-white leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-[12px] text-white/45 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
        {showBackButton && (
          <button
            onClick={goHome}
            aria-label="Home"
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white active:bg-white/20 transition-colors"
            title="Dashboard"
          >
            <HomeIcon size={22} />
          </button>
        )}
      </div>
    </div>
  );
}
