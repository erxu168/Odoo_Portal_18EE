/**
 * WAJ Radio — authorization guards. Same shape as shift-handover/access.ts:
 * capability via the permission registry, effective actor on shared tablets,
 * module access enforced server-side. On top of that, PLAYER routes only
 * answer the ONE physical tablet pinned in music settings — a manager phone
 * (or any other tablet) calling a player mutation directly gets a 403.
 */
import { cookies } from 'next/headers';
import { getDb, getUserById, getPermissionOverrides, type PortalUser } from '@/lib/db';
import { getCurrentUser, COOKIE_NAME } from '@/lib/auth';
import { roleCan, type Role } from '@/lib/permissions';
import { effectiveModuleIds } from '@/lib/modules';
import { resolveAttribution } from '@/lib/shift-attribution';
import { getMusicSettings } from '@/lib/music/db';

const MODULE_ID = 'music';

export const CAP = {
  play: 'music.play',
  queue: 'music.queue',
  manage: 'music.manage',
} as const;

export interface MusicActor {
  userId: number;
  name: string;
  employeeId: number | null;
  resolved: boolean;
  role: string;
  moduleAccess: string | null;
}

export function currentActor(user: PortalUser): MusicActor {
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

export type AuthzOk = { ok: true; user: PortalUser; actor: MusicActor };
export type AuthzErr = { ok: false; status: number; error: string };
export type Authz = AuthzOk | AuthzErr;

export function authorize(capability: string, opts?: { requireResolvedActor?: boolean }): Authz {
  const user = getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Please sign in.' };
  const actor = currentActor(user);
  if (opts?.requireResolvedActor && user.is_shared_device && !actor.resolved) {
    return { ok: false, status: 403, error: 'Sign in with your name on this tablet first.' };
  }
  const role = actor.role as Role;
  // Module gate: Music is manager-default, and the JUKEBOX TABLET's account
  // carries an explicit grant. A staff member PIN-signed-in on that tablet must
  // not lose the tablet's grant — so for PLAYER capabilities the module counts
  // as enabled when either the acting person OR the device account has it.
  // MANAGE stays strictly personal: the tablet's grant must never let someone
  // whose Music access was revoked approve songs or repin devices.
  const actorHasModule = effectiveModuleIds(role, actor.moduleAccess).includes(MODULE_ID);
  const playerCapability = capability === CAP.play || capability === CAP.queue;
  const deviceHasModule = playerCapability
    && effectiveModuleIds(user.role as Role, user.module_access ?? null).includes(MODULE_ID);
  if (!actorHasModule && !deviceHasModule) {
    return { ok: false, status: 403, error: 'Music is not enabled for you.' };
  }
  if (!roleCan(role, capability, getPermissionOverrides())) {
    return { ok: false, status: 403, error: 'You do not have permission for this action.' };
  }
  return { ok: true, user, actor };
}

/** The station_devices.id behind the CURRENT session, or null for normal logins. */
export function currentStationDeviceId(): number | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = getDb().prepare(`SELECT station_device_id FROM sessions WHERE token = ? AND expires_at > ?`)
    .get(token, new Date().toISOString()) as { station_device_id: number | null } | undefined;
  return row?.station_device_id ?? null;
}

/**
 * Player routes: only the assigned jukebox tablet may drive playback.
 * `requireResolvedActor` additionally demands a PIN-signed-in person (used for
 * queue/skip so actions are attributable; NOT for advance/state, so the music
 * doesn't stop when a PIN session times out mid-song).
 */
export function authorizePlayerDevice(opts?: { requireResolvedActor?: boolean }): Authz {
  const base = authorize(opts?.requireResolvedActor ? CAP.queue : CAP.play, opts);
  if (!base.ok) return base;
  if (!base.user.is_shared_device) {
    return { ok: false, status: 403, error: 'The player only runs on the WAJ Radio tablet.' };
  }
  const deviceId = currentStationDeviceId();
  const assigned = getMusicSettings().playerDeviceId;
  if (!assigned) return { ok: false, status: 409, error: 'No player tablet is assigned yet — a manager picks one in Music → Settings.' };
  if (deviceId !== assigned) return { ok: false, status: 403, error: 'This tablet is not the WAJ Radio player.' };
  return base;
}
