'use client';

import { useEffect } from 'react';
import { useTopBar } from '@/components/ui/TopBarContext';
import { KdsProvider } from '@/lib/kds/state';
import { TimerProvider } from '@/lib/kds/timers';
import TimerPanel from '@/components/kds/TimerPanel';
import './kds.css';

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  const { setHidden } = useTopBar();

  useEffect(() => {
    setHidden(true);
    // Set KDS favicon and title
    document.title = 'Krawings KDS';
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    const oldHref = link?.href;
    if (link) link.href = '/kds-icon.svg';
    const meta = document.querySelector("meta[name='theme-color']") as HTMLMetaElement | null;
    const oldTheme = meta?.content;
    if (meta) meta.content = '#0f172a';
    return () => {
      setHidden(false);
      document.title = 'Krawings Portal';
      if (link && oldHref) link.href = oldHref;
      if (meta && oldTheme) meta.content = oldTheme;
    };
  }, [setHidden]);

  return (
    <KdsProvider>
      <TimerProvider>
        <div className="kds">
          {children}
          <TimerPanel />
        </div>
      </TimerProvider>
    </KdsProvider>
  );
}
