/**
 * Auth helpers for API routes and server components.
 * Call getCurrentUser() in any API route to get the logged-in user.
 * Returns null if not authenticated.
 */
import { cookies } from 'next/headers';
import { getSessionUser, type PortalUser } from './db';

export const COOKIE_NAME = 'kw_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Get the currently logged-in user from the session cookie.
 * Works in API routes and server components.
 */
export function getCurrentUser(): PortalUser | null {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

/**
 * Require authentication. Returns the user or null.
 * API routes should check this and return 401 if null.
 */
export function requireAuth(): PortalUser | null {
  return getCurrentUser();
}

/**
 * Check if user has a specific role or higher.
 * admin > manager > staff
 */
export function hasRole(user: PortalUser, minRole: 'staff' | 'manager' | 'admin'): boolean {
  const hierarchy = { staff: 0, manager: 1, admin: 2 };
  return hierarchy[user.role] >= hierarchy[minRole];
}

export type { PortalUser };
