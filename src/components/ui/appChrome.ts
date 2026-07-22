/**
 * Single source of truth for the app's desktop nav rail / bottom tab bar.
 *
 * The rail (lg+) and the bottom tab bar (touch) are the same nav, rendered by
 * AppTabBar. On the routes below it renders NEITHER — because they carry their
 * own navigation (auth screens, HR / shift-handover with in-screen back) or are
 * full-viewport tools (KDS / kiosk).
 *
 * Whatever reserves horizontal space for the desktop rail (MainWrapper content,
 * AppTopBar) MUST offset ONLY when the rail is actually rendered — otherwise
 * content either slides under the rail (offset missing) or floats away from an
 * absent rail (offset applied with no rail). Both consult hasNavRail() so the
 * offset can never disagree with what AppTabBar draws.
 */
export const NAV_HIDDEN_ROUTES = [
  '/login', '/register', '/forgot-password', '/reset-password',
  '/hr', '/shift-handover', '/kiosk', '/confirm-shift',
];

export function isRouteMatch(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

/** True when this route renders the nav rail (lg+) / bottom tab bar. */
export function hasNavRail(pathname: string): boolean {
  return !isRouteMatch(pathname, NAV_HIDDEN_ROUTES);
}
