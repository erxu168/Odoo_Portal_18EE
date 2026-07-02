import { cookies } from 'next/headers';
import { getUserById, type PortalUser } from '@/lib/db';

/**
 * On a shared department device, work should be credited to the person who
 * signed in via "Working as" (PIN-verified), not to the shared account. The
 * active person is kept in a device-local `kw_acting` cookie by ShiftProvider.
 *
 * Returns the portal user id + Odoo employee id to attribute an action to.
 * Only honoured for is_shared_device accounts — a personal account always
 * attributes to itself, so it can't spoof someone else.
 */
const ACTING_COOKIE = 'kw_acting';

export function resolveAttribution(user: PortalUser): { userId: number; employeeId: number | null } {
  let userId = user.id;
  let employeeId = user.employee_id ?? null;

  if (user.is_shared_device) {
    try {
      const raw = cookies().get(ACTING_COOKIE)?.value;
      if (raw) {
        const acting = JSON.parse(decodeURIComponent(raw));
        const id = parseInt(String(acting.id), 10);
        if (id) {
          const actingUser = getUserById(id);
          if (actingUser && actingUser.active) {
            userId = actingUser.id;
            employeeId = actingUser.employee_id ?? null;
          }
        }
      }
    } catch { /* fall back to the shared account */ }
  }

  return { userId, employeeId };
}
