import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMyShifts } from '@/lib/odoo-tasks';

export async function GET() {
  try {
    const user = getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    if (!user.employee_id) {
      // User has no Odoo employee record linked yet
      return NextResponse.json({ shifts: [], warning: 'No employee record linked to this account' });
    }

    const shifts = await getMyShifts(user.employee_id);
    return NextResponse.json({ shifts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load shifts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
