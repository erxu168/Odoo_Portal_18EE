// Closing Report — authorization guards.
//
// Same contract as the Shift Handover module: capability check via the
// permission registry, per-user module access enforced server-side, company
// scoping through inventory-access, and a resolved PIN actor required for any
// write on a shared tablet.
import { getUserById, getPermissionOverrides, type PortalUser } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { roleCan, type Role } from '@/lib/permissions';
import { effectiveModuleIds } from '@/lib/modules';
import {
  companyScope as companyScopeOf,
  resolveScopedCompany,
  canAccessCompany,
} from '@/lib/inventory-access';
import { resolveAttribution } from '@/lib/shift-attribution';

const MODULE_ID = 'closing-report';

/** Capability keys — must match rows in PERMISSION_ACTIONS in permissions.ts. */
export const CAP = {
  view: 'closing.view',
  submit: 'closing.submit',
  review: 'closing.review',
  manage: 'closing.manage',
} as const;

export interface ClosingActor {
  userId: number;
  name: string;
  employeeId: number | null;
  resolved: boolean;
  role: string;
  moduleAccess: string | null;
}

/** Resolve who is really acting (the PIN-signed-in person on a shared tablet). */
export function currentActor(user: PortalUser): ClosingActor {
  const { userId, employeeId } = resolveAttribution(user);
  const resolved = userId !== user.id;
  let name = user.name;
  let role: string = user.role;
  let moduleAccess: string | null = user.module_access ?? null;
  if (resolved) {
    const acting = getUserById(userId);
    if (acting) { name = acting.name; role = acting.role; moduleAccess = acting.module_access ?? null; }
  }
  return { userId, name, employeeId, resolved, role, moduleAccess };
}

export type AuthzOk = { ok: true; user: PortalUser; actor: ClosingActor };
export type AuthzErr = { ok: false; status: number; error: string };
export type Authz = AuthzOk | AuthzErr;

export function authorize(capability: string, opts?: { requireResolvedActor?: boolean }): Authz {
  const user = getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Please sign in.' };
  const actor = currentActor(user);
  if (opts?.requireResolvedActor && user.is_shared_device && !actor.resolved) {
    return { ok: false, status: 403, error: 'Sign in with your name on this shared tablet before recording.' };
  }
  const role = actor.role as Role;
  if (!effectiveModuleIds(role, actor.moduleAccess).includes(MODULE_ID)) {
    return { ok: false, status: 403, error: 'Closing Report is not enabled for you.' };
  }
  if (!roleCan(role, capability, getPermissionOverrides())) {
    return { ok: false, status: 403, error: 'You do not have permission for this action.' };
  }
  return { ok: true, user, actor };
}

/** UI flags: what the acting person may do (same overrides the guard uses). */
export function actorCan(actor: ClosingActor, capability: string): boolean {
  return roleCan(actor.role as Role, capability, getPermissionOverrides());
}

/** Companies this user may LIST (undefined = unrestricted admin → no filter). */
export function readScope(user: PortalUser): number[] | undefined {
  return companyScopeOf(user);
}

/** The single company a mutation should act on, or null if not permitted. */
export function writeCompany(user: PortalUser, requested: number | null): number | null {
  return resolveScopedCompany(user, requested);
}

export { canAccessCompany };
