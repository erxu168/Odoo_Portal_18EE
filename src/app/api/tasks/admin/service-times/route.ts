import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { readServiceDays, saveServiceDays, type ServiceDayRow } from '@/lib/odoo-tasks';
import { moduleForbidden } from '@/lib/module-access';

/**
 * When Opening / Service / Closing start and end, per restaurant.
 *
 * The three periods run back to back, so a day is FOUR boundaries, not three
 * start/end pairs: day start → opening ends → service ends → day ends. A gap or
 * an overlap therefore cannot be expressed, and the only rule to enforce is
 * that the four run in order (Odoo does that).
 *
 * These times are what let a task with NO deadline of its own still be due,
 * remind, and count as overdue — it inherits the end of its period.
 */
export const dynamic = 'force-dynamic';

const WEEKDAYS = new Set(['', '0', '1', '2', '3', '4', '5', '6']);

/** Companies with at least one active department — the same list the
 *  end-of-day summary settings offer, so Settings shows one set of restaurants. */
async function eligibleCompanyIds(): Promise<number[]> {
  const depts = await getOdoo().searchRead(
    'hr.department',
    [['active', '=', true], ['company_id', '!=', false]],
    ['company_id'],
    { limit: 500 },
  );
  return Array.from(new Set(depts.map((d: { company_id: [number, string] }) => d.company_id[0])));
}

function badRow(r: unknown): string | null {
  const row = r as Record<string, unknown>;
  if (!WEEKDAYS.has(String(row?.weekday ?? ''))) return 'Unknown weekday';
  const nums = ['day_start', 'opening_end', 'service_end', 'day_end'].map(k => Number(row?.[k]));
  if (nums.some(n => !Number.isFinite(n) || n < 0 || n > 24)) return 'Times must be between 00:00 and 24:00';
  // Mirrors the Odoo constraint, so the screen can say so before a round trip.
  if (!(nums[0] < nums[1] && nums[1] < nums[2] && nums[2] < nums[3])) {
    return 'Times must run in order: day start, Opening ends, Service ends, day ends';
  }
  return null;
}

export async function GET() {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    requireRole('admin');
    const ids = await eligibleCompanyIds();
    if (!ids.length) return NextResponse.json({ ok: true, rows: [] });
    return NextResponse.json({ ok: true, rows: await readServiceDays(ids) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to read service times' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    requireRole('admin');
    const body = await req.json();
    const companyId = Number(body?.company_id);
    // Only a restaurant that actually runs task lists — stops an arbitrary
    // company id being written into the service-times table.
    if (!Number.isInteger(companyId) || !(await eligibleCompanyIds()).includes(companyId)) {
      return NextResponse.json({ error: 'Not a restaurant you can configure' }, { status: 403 });
    }
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows) return NextResponse.json({ error: 'rows must be an array' }, { status: 400 });
    for (const r of rows) {
      const problem = badRow(r);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }
    await saveServiceDays(companyId, rows as ServiceDayRow[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to save service times';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
