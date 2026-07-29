/**
 * Shared permission helpers for the Chef Guide (recipe) write routes.
 *
 * Each recipe write endpoint reads the live admin overrides ONCE per request and
 * binds a capability checker to the caller's role, so a handler stays a single
 * readable guard line and the "who can publish" rule lives in one place.
 *
 * The registry (src/lib/permissions.ts) is the source of truth for defaults;
 * /admin/permissions can override them per role, honored here on the next request.
 */
import { NextResponse } from 'next/server';
import { getPermissionOverrides } from '@/lib/db';
import { roleCan, type Role } from '@/lib/permissions';

/** Bind a capability checker to `role` using the CURRENT admin overrides. */
export function recipeCan(role: string): (key: string) => boolean {
  const overrides = getPermissionOverrides();
  return (key: string) => roleCan(role as Role, key, overrides);
}

/** Standard 403 for a recipe write the caller is not allowed to perform. */
export function recipeForbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
