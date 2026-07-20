/**
 * Shift Handover — authorization guards.
 *
 * One place that turns "is this request allowed?" into a typed result, so every
 * route enforces the same rules: capability (role) check via the portal's
 * permission registry, company scoping via inventory-access helpers, and a
 * resolved human actor on shared kitchen tablets before any mutation.
 */
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

const MODULE_ID = 'shift-handover';

/** Capability keys — must match rows added to PERMISSION_ACTIONS in permissions.ts. */
export const CAP = {
  view: 'handover.view',
  record: 'handover.production.record',
  actionCreate: 'handover.action.create',
  actionManageCritical: 'handover.action.manage_critical',
  submit: 'handover.submit',
  acknowledge: 'handover.acknowledge',
  discrepancyResolve: 'handover.discrepancy.resolve',
  configure: 'handover.configure',
  historyView: 'handover.history.view',
} as const;

export interface HandoverActor {
  userId: number;
  name: string;
  employeeId: number | null;
  /** True when this is a shared tablet with a real person signed in via PIN. */
  resolved: boolean;
  /** Effective role of the acting person (the PIN-signed-in user on a shared tablet). */
  role: string;
  /** Effective per-user module allowlist of the acting person. */
  moduleAccess: string | null;
}

/** Resolve who is really acting (the PIN-signed-in person on a shared tablet). */
export function currentActor(user: PortalUser): HandoverActor {
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

export type AuthzOk = { ok: true; user: PortalUser; actor: HandoverActor };
export type AuthzErr = { ok: false; status: number; error: string };
export type Authz = AuthzOk | AuthzErr;

/**
 * Authorize a request for a capability, using the EFFECTIVE principal — the
 * PIN-signed-in person on a shared kitchen tablet, else the session user. This
 * both fixes shared-tablet leaders (a manager PIN'd into a staff station gets
 * manager capabilities) and enforces per-user module access server-side (not
 * just in the UI). For mutations pass { requireResolvedActor: true } so a shared
 * tablet must have a real person signed in first.
 */
export function authorize(capability: string, opts?: { requireResolvedActor?: boolean }): Authz {
  const user = getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Please sign in.' };
  const actor = currentActor(user);
  if (opts?.requireResolvedActor && user.is_shared_device && !actor.resolved) {
    return { ok: false, status: 403, error: 'Sign in with your name on this shared tablet before recording.' };
  }
  const role = actor.role as Role;
  // Server-side module gate: a user whose access to this module was revoked
  // cannot reach it by calling the API directly.
  if (!effectiveModuleIds(role, actor.moduleAccess).includes(MODULE_ID)) {
    return { ok: false, status: 403, error: 'Shift Handover is not enabled for you.' };
  }
  if (!roleCan(role, capability, getPermissionOverrides())) {
    return { ok: false, status: 403, error: 'You do not have permission for this action.' };
  }
  return { ok: true, user, actor };
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
