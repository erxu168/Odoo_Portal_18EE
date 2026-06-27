import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/** Odoo stores datetimes as naive UTC "YYYY-MM-DD HH:MM:SS". */
function toOdooUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Tasks worth reminding about: not yet completed, with a due time that is
 * within the next couple of hours or recently overdue, for the register's
 * company. We filter on the deadline timestamp (absolute time) rather than the
 * list's calendar date, so it is robust across the UTC/local midnight boundary.
 * The KDS decides which of these are inside its 30-min reminder window.
 */
export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;
    if (!configId) return NextResponse.json({ tasks: [] });

    const odoo = getOdoo();

    const configs = await odoo.searchRead('pos.config', [['id', '=', configId]], ['company_id'], { limit: 1 });
    const companyId = configs.length && Array.isArray(configs[0].company_id) ? configs[0].company_id[0] : null;
    if (!companyId) return NextResponse.json({ tasks: [] });

    const now = Date.now();
    const lower = toOdooUtc(now - 12 * 60 * 60 * 1000); // ignore tasks overdue by more than 12h
    const upper = toOdooUtc(now + 2 * 60 * 60 * 1000);  // ignore tasks due more than 2h out

    const lines = await odoo.searchRead(
      'krawings.task.list.line',
      [
        ['list_id.company_id', '=', companyId],
        ['deadline_datetime', '!=', false],
        ['completed_at', '=', false],
        ['deadline_datetime', '>=', lower],
        ['deadline_datetime', '<=', upper],
      ],
      ['id', 'name', 'deadline_datetime'],
      { limit: 100 }
    );

    const tasks = lines.map((l: any) => ({
      id: l.id,
      name: l.name || 'Task',
      deadlineMs: new Date(l.deadline_datetime.replace(' ', 'T') + 'Z').getTime(),
    }));

    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] tasks fetch error:', msg);
    return NextResponse.json({ tasks: [], error: msg }, { status: 500 });
  }
}
