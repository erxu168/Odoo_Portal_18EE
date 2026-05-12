/**
 * Next.js middleware — runs on every request.
 * Checks for session cookie and redirects to /login if missing.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/api/auth', '/api/cron', '/api/internal/', '/api/products/', '/kds', '/api/kds'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
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
