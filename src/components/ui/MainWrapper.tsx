'use client';

import { usePathname } from 'next/navigation';

/**
 * Client wrapper for <main> that strips layout padding on full-screen module pages.
 * Recipes, etc. have their own headers/footers and need the full viewport.
 * KDS uses position:fixed and needs zero constraints from the parent.
 */

const FULL_SCREEN_ROUTES = ['/recipes', '/hr'];
const FULL_VIEWPORT_ROUTES = ['/kds'];

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullViewport = FULL_VIEWPORT_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isFullScreen = FULL_SCREEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  if (isFullViewport) {
    return <main>{children}</main>;
  }

  return (
    <main className={isFullScreen ? 'max-w-lg mx-auto' : 'max-w-lg mx-auto pt-9 pb-20'}>
      {children}
    </main>
  );
}
