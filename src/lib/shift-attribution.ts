import { cookies } from 'next/headers';
import { getUserById, getStationActor, type PortalUser } from '@/lib/db';
import { COOKIE_NAME } from '@/lib/auth';

/**
 * On a shared department device (kitchen tablet), work is credited to the person
 * who signed in with their PIN, not to the shared account. The acting person is
 * carried in an httpOnly `kw_actor` cookie holding a SERVER-MINTED token
 * (created in /api/station/pin-login after PIN verification). The token is
 * looked up server-side and must be bound to THIS station account — so it can't
 * be forged by editing a client cookie, nor reused under a different tablet login.
 *
 * Only honoured for is_shared_device accounts — a personal account always
 * attributes to itself, so it can't spoof someone else.
 */
const ACTOR_COOKIE = 'kw_actor';

export function resolveAttribution(user: PortalUser): { userId: number; employeeId: number | null } {
  let userId = user.id;
  let employeeId = user.employee_id ?? null;

  if (user.is_shared_device) {
    try {
      const token = cookies().get(ACTOR_COOKIE)?.value;
      const sessionToken = cookies().get(COOKIE_NAME)?.value;
      if (token && sessionToken) {
        const actor = getStationActor(token);
        // The token must belong to THIS tablet login SESSION (bound at mint time),
        // so it can't be forged or replayed under another/relogged session.
        if (actor && actor.station_session === sessionToken && actor.station_user_id === user.id) {
          const actingUser = getUserById(actor.acting_user_id);
          if (actingUser && actingUser.active && actingUser.status === 'active') {
            userId = actingUser.id;
            employeeId = actingUser.employee_id ?? null;
          }
        }
      }
    } catch { /* fall back to the shared account */ }
  }

  return { userId, employeeId };
}
