'use client';

import { usePathname } from 'next/navigation';

/**
 * Client wrapper for <main> that strips layout padding on full-screen module pages.
 * Recipes, etc. have their own headers/footers and need the full viewport.
 * KDS uses position:fixed and needs zero constraints from the parent.
 */

const FULL_SCREEN_ROUTES = ['/recipes', '/hr', '/shift-handover'];
const FULL_VIEWPORT_ROUTES = ['/kds', '/kiosk', '/confirm-shift'];
// Wide routes: no phone-width cap — the module's own screens choose their width
// (grid screens go wide on desktop, list/form screens self-center). Phones are
// unaffected because they're already narrower than any of these caps.
const WIDE_ROUTES = ['/shifts'];

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullViewport = FULL_VIEWPORT_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isFullScreen = FULL_SCREEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isWide = WIDE_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  if (isFullViewport) {
    return <main>{children}</main>;
  }

  if (isWide) {
    return <main className="pt-9 pb-20">{children}</main>;
  }

  if (isFullScreen) {
    return <main className="max-w-lg mx-auto">{children}</main>;
  }

  // Default: phone-width column on touch devices, growing to a centred desktop
  // container that reserves the left nav-rail (lg+). Phones/tablets are unchanged
  // — the cap only steps up at md/lg/xl; the rail offset only applies at lg.
  return (
    <main className="pt-9 pb-20 lg:pb-10 lg:pl-[var(--rail-w)]">
      <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
        {children}
      </div>
    </main>
  );
}
