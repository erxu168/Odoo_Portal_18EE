/**
 * Inventory Floorplan — authorization guards.
 *
 * Same shape as shift-handover/access.ts (the portal's reference pattern):
 * capability check via the permission registry, module gate via
 * effectiveModuleIds, company scoping via inventory-access, and the EFFECTIVE
 * principal on shared kitchen tablets (the PIN-signed-in person, not the
 * station account).
 *
 * Two capabilities only:
 *   view   — open the map, search, tap spots (staff+; its own registry key)
 *   manage — floors, uploads, review/publish, anchors, QR, type list
 *            (rides on the existing inventory.location.manage: whoever curates
 *            spots curates where they live on the plan)
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

const MODULE_ID = 'inventory';

export const FLOORPLAN_CAP = {
  view: 'inventory.floorplan.view',
  manage: 'inventory.location.manage',
} as const;

export interface FloorplanActor {
  userId: number;
  name: string;
  employeeId: number | null;
  resolved: boolean;
  role: string;
  moduleAccess: string | null;
}

export function currentActor(user: PortalUser): FloorplanActor {
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

export type FloorplanAuthzOk = { ok: true; user: PortalUser; actor: FloorplanActor };
export type FloorplanAuthzErr = { ok: false; status: number; error: string };
export type FloorplanAuthz = FloorplanAuthzOk | FloorplanAuthzErr;

export function authorizeFloorplan(
  capability: (typeof FLOORPLAN_CAP)[keyof typeof FLOORPLAN_CAP],
  opts?: { requireResolvedActor?: boolean },
): FloorplanAuthz {
  const user = getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Please sign in.' };
  const actor = currentActor(user);
  if (opts?.requireResolvedActor && user.is_shared_device && !actor.resolved) {
    return { ok: false, status: 403, error: 'Sign in with your name on this shared tablet first.' };
  }
  const role = actor.role as Role;
  if (!effectiveModuleIds(role, actor.moduleAccess).includes(MODULE_ID)) {
    return { ok: false, status: 403, error: 'Inventory is not enabled for you.' };
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
