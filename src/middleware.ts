/**
 * Next.js middleware — runs on every request.
 * Checks for session cookie and redirects to /login if missing.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// The Cooking Timer is a no-login kitchen-tablet screen (same model as /kds).
// Only the STAFF screen + its operating APIs are public; the manager Setup APIs
// (/api/cooktimer/profiles, /api/cooktimer/stations) are intentionally NOT here
// so they stay gated (they must also enforce role in their own handlers).
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/api/auth', '/api/cron', '/api/internal/', '/api/products/', '/kds', '/api/kds', '/kiosk', '/api/kiosk', '/api/tablet', '/api/device/ping', '/invite/', '/api/invite/', '/confirm-shift', '/api/shifts/confirm/email', '/cooktimer', '/api/cooktimer/queue', '/api/cooktimer/start', '/api/cooktimer/timers'];

/**
 * Is this path public (no login required)?
 *
 * Matches on PATH BOUNDARIES, not a bare prefix. A bare startsWith would make
 * "/cooktimer" also whitelist "/cooktimer-setup" (the MANAGER screen), quietly
 * serving it to anonymous users. Entries already ending in "/" keep their
 * intentional subtree semantics (e.g. "/api/internal/", "/invite/").
 * Exported for unit testing — see tests/middleware-public-paths.unit.spec.ts.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  // The push service worker must be reachable without auth — the browser
  // fetches it during registration and expects JS, not the login HTML.
  if (pathname === '/sw.js') {
    return NextResponse.next();
  }

  const session = request.cookies.get('kw_session');
  if (!session?.value) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  // Force the Capacitor WebView (and other clients) to never cache authenticated
  // page HTML. Static chunks still cache forever via their content-hashed
  // filenames, so this only affects the small HTML shells that point at them.
  // Without this, deploys can take days to surface inside the Android wrapper.
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
