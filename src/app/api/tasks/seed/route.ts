/**
 * POST /api/tasks/seed
 *
 * Sets up complete test data for the task management module:
 * 1. Links the logged-in portal user to Odoo employee id=45 (Amal Davis)
 * 2. Creates 2 planning.slot records for TODAY in Odoo
 * 3. Returns a summary of what was created
 *
 * Only works when NODE_ENV !== 'production' OR when ENABLE_TASK_SEED=true
 * Remove or protect this route before going live.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

// Change this to whichever Odoo employee id you want to test with.
// From our earlier query: id=45 = Amal Davis, id=24 = Vishal Choudhary
const TEST_EMPLOYEE_ID = 45;

function todayOdoo(hour: number, minute: number): string {
  // Returns "YYYY-MM-DD HH:MM:SS" in UTC for today at the given hour
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

export async function POST() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_TASK_SEED !== 'true'
  ) {
    return NextResponse.json({ error: 'Seed disabled in production' }, { status: 403 });
  }

  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const results: string[] = [];

  // ── Step 1: Link portal user to Odoo employee ──────────────────
  const db = getDb();
  db.prepare('UPDATE portal_users SET employee_id = ? WHERE id = ?')
    .run(TEST_EMPLOYEE_ID, user.id);
  results.push(`✓ Linked portal user "${user.name}" (id=${user.id}) to Odoo employee id=${TEST_EMPLOYEE_ID}`);

  // ── Step 2: Create planning.slots for today in Odoo ───────────
  const odoo = getOdoo();
  const created: number[] = [];

  const slots = [
    {
      name: 'Morning Opening',
      start_datetime: todayOdoo(5, 0),   // 07:00 Berlin = 05:00 UTC
      end_datetime:   todayOdoo(9, 0),   // 11:00 Berlin = 09:00 UTC
      employee_id:    TEST_EMPLOYEE_ID,
      role_id:        30,                // D2 (GBM) — from real data
    },
    {
      name: 'Evening Service',
      start_datetime: todayOdoo(15, 0),  // 17:00 Berlin = 15:00 UTC
      end_datetime:   todayOdoo(21, 0),  // 23:00 Berlin = 21:00 UTC
      employee_id:    TEST_EMPLOYEE_ID,
      role_id:        30,
    },
  ];

  for (const slot of slots) {
    try {
      const id = await odoo.create('planning.slot', slot);
      created.push(id);
      results.push(`✓ Created planning.slot id=${id}: "${slot.name}" ${slot.start_datetime} → ${slot.end_datetime}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`✗ Failed to create slot "${slot.name}": ${msg}`);
    }
  }

  // ── Step 3: Verify the slots can be read back ──────────────────
  const today = new Date().toISOString().substring(0, 10);
  const check = await odoo.searchRead(
    'planning.slot',
    [['employee_id', '=', TEST_EMPLOYEE_ID], ['start_datetime', 'like', today]],
    ['id', 'name', 'start_datetime', 'end_datetime', 'role_id'],
    { order: 'start_datetime asc' },
  );
  results.push(`✓ Verified: ${check.length} slot(s) found for employee ${TEST_EMPLOYEE_ID} today`);

  return NextResponse.json({
    ok: true,
    employee_id: TEST_EMPLOYEE_ID,
    slots_created: created,
    slots_today: check,
    log: results,
  });
}

// DELETE /api/tasks/seed — clean up test slots
export async function DELETE() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_TASK_SEED !== 'true'
  ) {
    return NextResponse.json({ error: 'Seed disabled in production' }, { status: 403 });
  }

  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const odoo = getOdoo();
  const today = new Date().toISOString().substring(0, 10);

  // Find and delete today's test slots
  const slots = await odoo.searchRead(
    'planning.slot',
    [['employee_id', '=', TEST_EMPLOYEE_ID], ['start_datetime', 'like', today]],
    ['id', 'name'],
  );
  const ids = slots.map((s: { id: number }) => s.id);
  if (ids.length) await odoo.unlink('planning.slot', ids);

  return NextResponse.json({ ok: true, deleted: ids });
}
