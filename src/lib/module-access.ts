/**
 * The ONE place that answers "is this person allowed to use this module?".
 *
 * Why this exists (audit, 2026-08-04): module access used to be a *display*
 * rule only — the dashboard tiles and the hamburger hid what you weren't
 * granted, and nothing on the server ever checked it. Typing the URL worked
 * fine, and the bottom tab bar didn't even hide. So "turn the module off"
 * did not mean "no access".
 *
 * Now every surface derives from this file:
 *   - pages  -> <ModuleGate moduleId="..."> in each module's layout.tsx
 *   - API    -> moduleForbidden('...') at the top of each handler
 *   - UI     -> /api/auth/me returns userModuleIds(), which the dashboard,
 *               the hamburger and the bottom tab bar all filter by.
 *
 * Fail-closed by design: an unknown module id denies access rather than
 * allowing it, so a typo in a guard can never open a door. `tests/
 * module-access.unit.spec.ts` asserts every id used in a guard is real.
 *
 * This is the VISIBILITY layer ("can you open the module at all"). It is
 * deliberately separate from src/lib/permissions.ts, which is the CAPABILITY
 * layer ("what may you do once you are inside"). Both are enforced.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from './auth';
import { canUseModule, moduleIdsForUser } from './modules';
import type { PortalUser } from './db';

/** A candidate (applicant with no employee record yet) only ever gets HR. */
export function isCandidate(user: PortalUser): boolean {
  return !!user.applicant_id && !user.employee_id;
}

/** The module ids this user may use — the single source of truth for every surface. */
export function userModuleIds(user: PortalUser): string[] {
  return moduleIdsForUser(user.role, user.module_access, isCandidate(user));
}

/** Can this user use this module? Unknown ids fail closed (deny). */
export function userCanUseModule(user: PortalUser, moduleId: string): boolean {
  return canUseModule(user.role, user.module_access, isCandidate(user), moduleId);
}

export type ModuleAccessResult =
  | { ok: true; user: PortalUser }
  | { ok: false; reason: 'unauthenticated' | 'forbidden'; user: PortalUser | null };

/**
 * Check the CURRENT request's session against a module. Used by both the page
 * gate and the API guard so the two can never disagree.
 *
 * Pass several ids when one route legitimately serves more than one module and
 * ANY of them grants entry — /recipes is both "Chef Guide" (`recipes`) and
 * "Production Guide" (`production-guide`).
 */
export function checkModuleAccess(moduleId: string | string[]): ModuleAccessResult {
  const ids = Array.isArray(moduleId) ? moduleId : [moduleId];
  const user = getCurrentUser();
  if (!user) return { ok: false, reason: 'unauthenticated', user: null };
  if (!ids.some((id) => userCanUseModule(user, id))) {
    return { ok: false, reason: 'forbidden', user };
  }
  return { ok: true, user };
}

/**
 * API guard. Returns a response to send back, or null when access is allowed:
 *
 *   const denied = moduleForbidden('rentals');
 *   if (denied) return denied;
 *
 * Returns a response rather than throwing so it behaves identically whether or
 * not the handler wraps its body in try/catch — a throwing guard inside an
 * existing try/catch surfaces as a 500, which is how the Purchase routes ended
 * up returning 500 instead of 403.
 */
export function moduleForbidden(moduleId: string | string[]): NextResponse | null {
  const result = checkModuleAccess(moduleId);
  if (result.ok) return null;
  return result.reason === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
