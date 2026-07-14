/**
 * POST /api/shifts/publish-upcoming {company_id, notify?, dry_run?}
 *
 * Publishes EVERY draft slot of the company that starts now or later — across
 * all upcoming weeks, not just one — in a single batched Odoo write. Use for
 * multi-week plans (e.g. a recurring shift) so a manager doesn't have to open
 * each week and publish it separately.
 *
 * dry_run:true returns { count, weeks } without publishing (drives the confirm
 * sheet's "publish all upcoming" label). Otherwise each distinct assigned
 * employee is notified once (shift_published), matching publish-week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { notifyEmployee } from '@/lib/shifts-notify';
import { berlinISOWeekKey, fmtDay, fmtTimeRange, nowOdooUtc } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

type OdooRow = Record<string, unknown>;

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}
function m2oName(v: unknown): string {
  return Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '';
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const notify = body.notify !== false;
    const dryRun = body.dry_run === true;
    const now = nowOdooUtc();

    const rows = (await getOdoo().searchRead(
      'planning.slot',
      [
        ['company_id', '=', companyId],
        ['state', '=', 'draft'],
        ['start_datetime', '>=', now],
      ],
      ['start_datetime', 'end_datetime', 'role_id', 'employee_id'],
      { limit: 3000, order: 'start_datetime asc' },
    )) as OdooRow[];

    const weeks = new Set(rows.map(r => berlinISOWeekKey(str(r.start_datetime))));

    if (dryRun) {
      return NextResponse.json({ count: rows.length, weeks: weeks.size });
    }
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, published: 0, weeks: 0 });
    }

    await getOdoo().write('planning.slot', rows.map(r => r.id as number), { state: 'published' });

    if (notify) {
      const byEmployee = new Map<number, OdooRow[]>();
      for (const r of rows) {
        const eid = m2oId(r.employee_id);
        if (eid === null) continue;
        const list = byEmployee.get(eid) ?? [];
        list.push(r);
        byEmployee.set(eid, list);
      }
      for (const [employeeId, list] of Array.from(byEmployee.entries())) {
        const first = list[0];
        await notifyEmployee(employeeId, companyId, 'shift_published', {
          day: fmtDay(str(first.start_datetime)),
          time: fmtTimeRange(str(first.start_datetime), str(first.end_datetime)),
          roleName: m2oName(first.role_id),
          count: list.length,
          message:
            list.length === 1
              ? 'A new shift was published for you.'
              : `${list.length} new shifts were published for you.`,
        });
      }
    }

    return NextResponse.json({ ok: true, published: rows.length, weeks: weeks.size });
  } catch (err: unknown) {
    return serverError('POST publish-upcoming', err);
  }
}
