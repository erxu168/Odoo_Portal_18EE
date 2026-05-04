import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOdoo, PORTAL_LANG_COOKIE } from '@/lib/odoo';
import { updateUserPreferences } from '@/lib/db';

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

  let preferences: Record<string, any> = {};
  try { preferences = JSON.parse(user.preferences || '{}'); } catch { /* ignore */ }

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
      preferences,
    },
  });
}

/**
 * PATCH /api/auth/me
 * Update current user preferences (e.g. dashboard tile order).
 */
export async function PATCH(request: Request) {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { preferences } = body;

    if (!preferences || typeof preferences !== 'object') {
      return NextResponse.json({ error: 'preferences object required' }, { status: 400 });
    }

    updateUserPreferences(user.id, preferences);

    const response = NextResponse.json({ success: true });

    // Keep portal_lang cookie in sync with the saved preference so Odoo RPC
    // calls immediately pick up the new language without a re-login.
    if (preferences.lang === 'de_DE' || preferences.lang === 'en_US') {
      response.cookies.set(PORTAL_LANG_COOKIE, preferences.lang, {
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
