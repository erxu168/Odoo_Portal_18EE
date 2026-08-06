/**
 * GET  /api/tasks/admin/summary-settings — per-company end-of-day summary config.
 * PUT  /api/tasks/admin/summary-settings — save { companies:[{id,enabled,hour}] }.
 *
 * Admin only. Backed by res.company.kw_task_summary_enabled + _hour (Europe/Berlin,
 * Float; 22.5 = 22:30). Only companies with ≥1 active department are listed.
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

const F_ON = 'kw_task_summary_enabled';
const F_HOUR = 'kw_task_summary_hour';
// Any time of day, to the minute (Berlin). Was four fixed choices; the owner
// wanted to set it individually. Still bounded and still snapped to a whole
// minute, so a tampered client can't store 22.37194 or a negative hour.

async function eligibleCompanyIds(): Promise<number[]> {
  const depts = await getOdoo().searchRead(
    'hr.department',
    [['active', '=', true], ['company_id', '!=', false]],
    ['company_id'],
    { limit: 500 },
  );
  return Array.from(new Set(depts.map((d: any) => d.company_id[0] as number)));
}

function missingFieldError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.includes(F_ON) || msg.includes(F_HOUR)) &&
    (msg.toLowerCase().includes('invalid field') || msg.toLowerCase().includes('unknown field'));
}

export async function GET() {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    requireRole('admin');
    const ids = await eligibleCompanyIds();
    if (ids.length === 0) return NextResponse.json({ companies: [] });
    const companies = await getOdoo().searchRead(
      'res.company',
      [['id', 'in', ids]],
      ['id', 'name', F_ON, F_HOUR],
      { order: 'sequence asc, id asc' },
    );
    return NextResponse.json({
      companies: companies.map((c: any) => ({
        id: c.id,
        name: c.name,
        enabled: !!c[F_ON],
        hour: typeof c[F_HOUR] === 'number' ? c[F_HOUR] : 22.5,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET summary-settings error:', err);
    if (missingFieldError(err)) {
      return NextResponse.json(
        { error: 'The task manager module in Odoo has not been upgraded yet — the summary fields are missing.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Could not load summary settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    requireRole('admin');
    const body = await request.json();
    const rows: unknown = body?.companies;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No settings to save' }, { status: 400 });
    }

    const updates: { id: number; enabled: boolean; hour: number }[] = [];
    for (const row of rows as any[]) {
      const id = Number(row?.id);
      // Snap to a whole minute: a float straight from a client could carry
      // meaningless precision into a value we later render back as a time.
      const hour = Math.round(Number(row?.hour) * 60) / 60;
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
      }
      // Bounded to the evening. Free entry was the ask, but a recap of "today"
      // sent at 02:30 reports a day that has barely begun — everything unticked,
      // every task "missed", in the middle of the night. 17:00 is the earliest
      // hour at which the number could mean anything.
      if (!Number.isFinite(hour) || hour < 17 || hour > 23.75) {
        return NextResponse.json(
          { error: 'Pick a send time between 17:00 and 23:45 — earlier than that, the day is not over yet.' },
          { status: 400 },
        );
      }
      // Strict boolean — a JSON string like "false" must not read as enabled.
      updates.push({ id, enabled: row?.enabled === true, hour });
    }

    const eligible = new Set(await eligibleCompanyIds());
    if (updates.some(u => !eligible.has(u.id))) {
      return NextResponse.json({ error: 'Unknown company in settings' }, { status: 400 });
    }

    const odoo = getOdoo();
    for (const u of updates) {
      await odoo.write('res.company', [u.id], { [F_ON]: u.enabled, [F_HOUR]: u.hour });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT summary-settings error:', err);
    if (missingFieldError(err)) {
      return NextResponse.json(
        { error: 'The task manager module in Odoo has not been upgraded yet — the summary fields are missing.' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'Save failed — reload and try again.' },
      { status: 500 },
    );
  }
}
