/**
 * GET  /api/tasks/admin/spawn-time — per-company daily-checklist spawn hour.
 * PUT  /api/tasks/admin/spawn-time — save the hours.
 *
 * Admin only. Backed by `res.company.kw_task_spawn_hour` (added by the
 * krawings_task_manager Odoo addon, default 2 = 02:00 Europe/Berlin). The
 * spawn cron runs hourly and creates each company's daily task lists on the
 * first pass at or after its configured hour.
 *
 * Only companies with at least one active hr.department are listed — task
 * templates require a department, so a spawn hour is meaningless without one
 * (this also hides the stale test companies in Odoo).
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export const dynamic = 'force-dynamic';

const FIELD = 'kw_task_spawn_hour';

/** Companies eligible for a spawn-hour setting: those with ≥1 active department. */
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
  return msg.includes(FIELD) && (msg.toLowerCase().includes('invalid field') || msg.toLowerCase().includes('unknown field'));
}

export async function GET() {
  try {
    requireRole('admin');
    const ids = await eligibleCompanyIds();
    if (ids.length === 0) return NextResponse.json({ companies: [] });
    const companies = await getOdoo().searchRead(
      'res.company',
      [['id', 'in', ids]],
      ['id', 'name', FIELD],
      { order: 'sequence asc, id asc' },
    );
    return NextResponse.json({
      companies: companies.map((c: any) => ({
        id: c.id,
        name: c.name,
        spawn_hour: Number.isInteger(c[FIELD]) ? c[FIELD] : 2,
      })),
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET /api/tasks/admin/spawn-time error:', err);
    if (missingFieldError(err)) {
      return NextResponse.json(
        { error: 'The task manager module in Odoo has not been upgraded yet — the spawn-time field is missing.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Could not load spawn-time settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    requireRole('admin');
    const body = await request.json();
    const rows: unknown = body?.companies;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No settings to save' }, { status: 400 });
    }

    const updates: { id: number; hour: number }[] = [];
    for (const row of rows as any[]) {
      const id = Number(row?.id);
      const hour = Number(row?.spawn_hour);
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
      }
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ error: 'The spawn hour must be between 0 and 23.' }, { status: 400 });
      }
      updates.push({ id, hour });
    }

    // Never trust client-sent ids: only companies that are actually eligible.
    const eligible = new Set(await eligibleCompanyIds());
    const rejected = updates.filter(u => !eligible.has(u.id));
    if (rejected.length > 0) {
      return NextResponse.json({ error: 'Unknown company in settings' }, { status: 400 });
    }

    const odoo = getOdoo();
    for (const u of updates) {
      await odoo.write('res.company', [u.id], { [FIELD]: u.hour });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT /api/tasks/admin/spawn-time error:', err);
    if (missingFieldError(err)) {
      return NextResponse.json(
        { error: 'The task manager module in Odoo has not been upgraded yet — the spawn-time field is missing.' },
        { status: 503 },
      );
    }
    // Don't leak raw Odoo RPC/debug text to the browser.
    return NextResponse.json(
      { error: 'Save failed — the settings may be partially saved; reload and try again.' },
      { status: 500 },
    );
  }
}
