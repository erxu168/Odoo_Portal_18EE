'use client';

import { useEffect } from 'react';
import { useTopBar } from '@/components/ui/TopBarContext';
import './cooktimer.css';

/**
 * Immersive layout for the Cooking Timer — no portal nav chrome (same rule as
 * the KDS and recipe screens). The page's fixed .ctimer root fills the screen.
 */
export default function CookTimerLayout({ children }: { children: React.ReactNode }) {
  const { setHidden } = useTopBar();

  useEffect(() => {
    setHidden(true);
    const prevTitle = document.title;
    document.title = 'Cooking Timer';
    const meta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
    const prevTheme = meta?.content;
    if (meta) meta.content = '#0c1015';
    return () => {
      setHidden(false);
      document.title = prevTitle;
      if (meta && prevTheme) meta.content = prevTheme;
    };
  }, [setHidden]);

  return <>{children}</>;
}
