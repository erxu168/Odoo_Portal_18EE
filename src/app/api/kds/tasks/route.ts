import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/** Today's calendar date (YYYY-MM-DD) in Europe/Berlin. */
function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

/**
 * Due/upcoming tasks from today's task list(s) for the register's company.
 * Returns only tasks that have a due time set and are not yet completed; the
 * KDS decides which are "within the reminder window". No order data here.
 */
export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;
    if (!configId) return NextResponse.json({ tasks: [] });

    const odoo = getOdoo();

    // Company that owns this register.
    const configs = await odoo.searchRead('pos.config', [['id', '=', configId]], ['company_id'], { limit: 1 });
    const companyId = configs.length && Array.isArray(configs[0].company_id) ? configs[0].company_id[0] : null;
    if (!companyId) return NextResponse.json({ tasks: [] });

    // Today's task lists for that company.
    const lists = await odoo.searchRead(
      'krawings.task.list',
      [['date', '=', berlinToday()], ['company_id', '=', companyId]],
      ['id'],
      { limit: 50 }
    );
    const listIds = lists.map((l: any) => l.id);
    if (listIds.length === 0) return NextResponse.json({ tasks: [] });

    // Task lines that have a deadline and are not yet done.
    const lines = await odoo.searchRead(
      'krawings.task.list.line',
      [
        ['list_id', 'in', listIds],
        ['deadline_datetime', '!=', false],
        ['completed_at', '=', false],
      ],
      ['id', 'name', 'deadline_datetime'],
      { limit: 100 }
    );

    const tasks = lines.map((l: any) => ({
      id: l.id,
      name: l.name || 'Task',
      // Odoo datetimes are naive UTC ("YYYY-MM-DD HH:MM:SS"); convert to epoch ms.
      deadlineMs: new Date(l.deadline_datetime.replace(' ', 'T') + 'Z').getTime(),
    }));

    return NextResponse.json({ tasks });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] tasks fetch error:', msg);
    return NextResponse.json({ tasks: [], error: msg }, { status: 500 });
  }
}
