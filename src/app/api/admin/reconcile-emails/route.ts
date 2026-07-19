import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { listEmployeeLinkedUsers, setUserEmailByEmployeeId } from '@/lib/db';

/**
 * POST /api/admin/reconcile-emails — one-time (reusable) cleanup: align every login account's
 * email to its linked employee's PROFILE Work email (the single source of truth). Admin only.
 * Best-effort per account: empty profile email or a UNIQUE collision is skipped and reported.
 */
export async function POST() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const users = listEmployeeLinkedUsers();
    const empIds = Array.from(new Set(users.map((u) => u.employee_id)));
    const tally: Record<string, number> = { total: users.length, updated: 0, unchanged: 0, empty: 0, no_user: 0, collision: 0, error: 0 };
    const changes: { employee_id: number; from: string; to: string }[] = [];

    if (empIds.length) {
      const odoo = getOdoo();
      const emps = await odoo.searchRead('hr.employee', [['id', 'in', empIds]], ['id', 'work_email']);
      const emailByEmp = new Map<number, string>();
      for (const e of emps) emailByEmp.set(e.id, typeof e.work_email === 'string' ? e.work_email : '');

      for (const u of users) {
        const work = emailByEmp.get(u.employee_id) || '';
        let outcome: string;
        try {
          outcome = setUserEmailByEmployeeId(u.employee_id, work);
        } catch (e) {
          console.error('[reconcile-emails] employee', u.employee_id, e);
          outcome = 'error';
        }
        tally[outcome] = (tally[outcome] || 0) + 1;
        if (outcome === 'updated') changes.push({ employee_id: u.employee_id, from: u.email, to: work.toLowerCase().trim() });
      }
    }

    return NextResponse.json({ ...tally, changes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Reconcile failed';
    console.error('POST /api/admin/reconcile-emails error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
