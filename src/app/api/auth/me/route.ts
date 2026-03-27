import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/auth/me
 * Returns the currently logged-in user with avatar from Odoo.
 */
export async function GET() {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let avatar: string | null = null;
  if (user.employee_id) {
    try {
      const odoo = getOdoo();
      const emps = await odoo.searchRead('hr.employee', [['id', '=', user.employee_id]], ['image_128'], { limit: 1 });
      if (emps.length > 0 && emps[0].image_128) {
        avatar = emps[0].image_128;
      }
    } catch { /* Odoo unavailable — skip avatar */ }
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id,
      applicant_id: user.applicant_id,
      must_change_password: !!user.must_change_password,
      is_candidate: !!user.applicant_id && !user.employee_id,
      avatar,
    },
  });
}
