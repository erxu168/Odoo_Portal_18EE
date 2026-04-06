'use client';

import { useEffect } from 'react';
import { useTopBar } from '@/components/ui/TopBarContext';
import { KdsProvider } from '@/lib/kds/state';
import './kds.css';

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  const { setHidden } = useTopBar();

  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, [setHidden]);

  return (
    <KdsProvider>
      <div className="kds">
        {children}
      </div>
    </KdsProvider>
  );
}
