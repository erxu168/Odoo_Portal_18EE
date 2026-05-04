/**
 * Auth helpers for API routes and server components.
 * Call getCurrentUser() in any API route to get the logged-in user (returns null if not authenticated).
 * Call requireAuth() to get the user or throw AuthError.
 * Call requireRole('manager') to enforce a minimum role or throw AuthError.
 */
import { cookies } from 'next/headers';
import { getSessionUser, type PortalUser } from './db';

export const COOKIE_NAME = 'kw_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Custom error class for auth failures.
 * Catch this in route handlers to return proper HTTP status codes.
 */
export class AuthError extends Error {
  status: number;
  constructor(message = 'Unauthorized', status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Get the currently logged-in user from the session cookie.
 * Works in API routes and server components.
 * Returns null if not authenticated — use requireAuth() to enforce.
 */
export function getCurrentUser(): PortalUser | null {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

/**
 * Require authentication. Returns the user or throws AuthError.
 * Use inside a try/catch in API routes.
 */
export function requireAuth(): PortalUser {
  const user = getCurrentUser();
  if (!user) throw new AuthError('Unauthorized', 401);
  return user;
}

/**
 * Require a minimum role. Returns the user or throws AuthError.
 * Role hierarchy: admin > manager > staff
 */
export function requireRole(minRole: 'staff' | 'manager' | 'admin'): PortalUser {
  const user = requireAuth();
  if (!hasRole(user, minRole)) throw new AuthError('Forbidden', 403);
  return user;
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
