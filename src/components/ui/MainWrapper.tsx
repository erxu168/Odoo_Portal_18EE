'use client';

import { usePathname } from 'next/navigation';

/**
 * Client wrapper for <main> that strips layout padding on full-screen module pages.
 * Recipes, etc. have their own headers/footers and need the full viewport.
 */

const FULL_SCREEN_ROUTES = ['/recipes', '/hr', '/kds'];

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullScreen = FULL_SCREEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  return (
    <main className={isFullScreen ? 'max-w-lg mx-auto' : 'max-w-lg mx-auto pt-9 pb-20'}>
      {children}
    </main>
  );
}
