/**
 * Shifts module — notification fan-out.
 *
 * Every notification is stored in-app via addNotification (shift_notifications,
 * keyed by employee_id) AND pushed best-effort via web push to the matching
 * portal user. Push is never allowed to break the calling flow — all push
 * errors are swallowed with a [shifts] warning (e.g. missing VAPID keys).
 *
 * Payload convention: always include the slot summary {day, time, roleName}
 * plus the people's names, so list screens can render without extra fetches.
 */
import { getDb, parseCompanyIds } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';
import type { PushPayload } from '@/lib/push';
import { addNotification } from '@/lib/shifts-db';

const PUSH_TITLES: Record<string, string> = {
  cover_request_received: 'Cover request',
  cover_accepted: 'Cover request accepted',
  cover_declined_by_teammate: 'Cover request declined',
  cover_cancelled: 'Cover request cancelled',
  cover_approved: 'Shift cover approved',
  cover_declined: 'Shift cover declined',
  cover_auto_applied: 'Shift cover applied',
  cover_expired: 'Cover request expired',
  cover_invalidated: 'Cover request no longer valid',
  sick_reported: 'Sick report',
  shift_published: 'New shifts published',
};

function buildPushPayload(type: string, payload: object): PushPayload {
  const p = payload as Record<string, unknown>;
  const day = typeof p.day === 'string' ? p.day : '';
  const time = typeof p.time === 'string' ? p.time : '';
  const roleName = typeof p.roleName === 'string' ? p.roleName : '';
  const message = typeof p.message === 'string' ? p.message : '';
  const summary = [day, time, roleName].filter(Boolean).join(' · ');
  return {
    title: PUSH_TITLES[type] ?? 'Shifts update',
    body: [summary, message].filter(Boolean).join(' — ') || 'Open the portal for details.',
    url: '/shifts',
    tag: `shifts-${type}`,
  };
}

async function pushBestEffort(userId: number, type: string, payload: object): Promise<void> {
  try {
    await sendPushToUser(userId, buildPushPayload(type, payload));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[shifts] Web push to user ${userId} failed (ignored): ${msg}`);
  }
}

interface PortalUserRow {
  id: number;
  role: string;
  employee_id: number | null;
  allowed_company_ids: string;
}

/**
 * Notify one employee: in-app notification row + best-effort web push to the
 * portal account linked to that employee (if any).
 */
export async function notifyEmployee(
  employeeId: number,
  companyId: number,
  type: string,
  payload: object,
): Promise<void> {
  addNotification({ employeeId, companyId, type, payload });

  const user = getDb()
    .prepare(
      "SELECT id FROM portal_users WHERE employee_id = ? AND active = 1 AND status = 'active'"
    )
    .get(employeeId) as { id: number } | undefined;
  if (user) {
    await pushBestEffort(user.id, type, payload);
  }
}

/**
 * Notify all managers of a company: every active portal user with role
 * manager/admin whose allowed_company_ids contains the company (admins with an
 * empty company list are treated as all-company, matching the repo convention).
 * In-app rows are written for managers linked to an employee; push goes to the
 * portal account either way.
 */
export async function notifyManagers(
  companyId: number,
  type: string,
  payload: object,
): Promise<void> {
  const rows = getDb()
    .prepare(
      "SELECT id, role, employee_id, allowed_company_ids FROM portal_users WHERE active = 1 AND status = 'active' AND role IN ('manager','admin')"
    )
    .all() as PortalUserRow[];

  const targets = rows.filter(r => {
    const ids = parseCompanyIds(r.allowed_company_ids);
    return ids.includes(companyId) || (r.role === 'admin' && ids.length === 0);
  });

  const notifiedEmployeeIds = new Set<number>();
  for (const user of targets) {
    if (user.employee_id !== null && !notifiedEmployeeIds.has(user.employee_id)) {
      notifiedEmployeeIds.add(user.employee_id);
      addNotification({ employeeId: user.employee_id, companyId, type, payload });
    }
  }
  await Promise.all(targets.map(user => pushBestEffort(user.id, type, payload)));
}
