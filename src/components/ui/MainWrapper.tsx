'use client';

import { usePathname } from 'next/navigation';

/**
 * Client wrapper for <main> that adapts layout per route.
 * Recipes, etc. have their own headers/footers and need the full viewport.
 * KDS uses position:fixed and needs zero constraints from the parent.
 *
 * Desktop nav is the hamburger drawer + home tiles (no side rail), so content
 * simply grows and centres on wide screens — no horizontal offset to reserve.
 */

const FULL_SCREEN_ROUTES = ['/recipes', '/shift-handover'];
const FULL_VIEWPORT_ROUTES = ['/kds', '/kiosk', '/confirm-shift'];
// Wide routes: no phone-width cap and top-bar clearance (pt-9). Each screen
// chooses its own content width (grids go wide, dashboards self-centre).
const WIDE_ROUTES = ['/shifts', '/hr'];

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
  // container. Phones/tablets are unchanged — the cap only steps up at md/lg/xl.
  return (
    <main className="pt-9 pb-20 lg:pb-10">
      <div className="mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
        {children}
      </div>
    </main>
  );
}
