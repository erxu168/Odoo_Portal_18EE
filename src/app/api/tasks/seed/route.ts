/**
 * POST /api/tasks/seed
 * Links the logged-in portal user to Odoo employee id=45 and returns stub
 * shifts for today. No Odoo writes needed — planning.slot has too many
 * required fields to create programmatically without a full form.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

const TEST_EMPLOYEE_ID = 45;

export async function POST() {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  // Link portal user to Odoo employee
  const db = getDb();
  db.prepare('UPDATE portal_users SET employee_id = ? WHERE id = ?')
    .run(TEST_EMPLOYEE_ID, user.id);

  return NextResponse.json({
    ok: true,
    employee_id: TEST_EMPLOYEE_ID,
    log: [
      `✓ Linked "${user.name}" to Odoo employee id=${TEST_EMPLOYEE_ID}`,
      '✓ Stub shifts for today will now appear',
      '✓ Reload complete — tap a shift to open its checklist',
    ],
  });
}

export async function DELETE() {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const db = getDb();
  db.prepare('UPDATE portal_users SET employee_id = NULL WHERE id = ?').run(user.id);

  return NextResponse.json({ ok: true });
}
