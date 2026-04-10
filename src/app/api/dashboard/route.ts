import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { countUsersByStatus } from '@/lib/db';
import { getCurrentUser, hasRole } from '@/lib/auth';

/**
 * GET /api/dashboard
 * Returns badge counts and shift info for the dashboard.
 * Live data from Odoo where available, mock data for unbuilt modules.
 */
export async function GET() {
  try {
    const odoo = getOdoo();
    const user = getCurrentUser();

    // ── Live: MO counts from Odoo ──
    let activeMoCount = 0;
    let dueMoCount = 0;
    let doneTodayCount = 0;
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const [activeMos, dueMos, doneMos] = await Promise.all([
        odoo.searchRead(
          'mrp.production',
          [['state', 'in', ['confirmed', 'progress']]],
          ['id'],
          { limit: 200 },
        ),
        odoo.searchRead(
          'mrp.production',
          [
            ['state', 'in', ['confirmed', 'progress']],
            ['date_deadline', '<=', todayStr + ' 23:59:59'],
          ],
          ['id'],
          { limit: 200 },
        ),
        odoo.searchRead(
          'mrp.production',
          [
            ['state', '=', 'done'],
            ['date_finished', '>=', todayStr + ' 00:00:00'],
          ],
          ['id'],
          { limit: 200 },
        ),
      ]);
      activeMoCount = activeMos.length;
      dueMoCount = dueMos.length;
      doneTodayCount = doneMos.length;
    } catch (e) {
      console.error('Dashboard: failed to fetch MO counts', e);
    }

    // ── Live: pending registration count (admin/manager only) ──
    let pendingRegistrations = 0;
    if (user && hasRole(user, 'admin')) {
      try {
        pendingRegistrations = countUsersByStatus('pending');
      } catch (e) {
        console.error('Dashboard: failed to count pending registrations', e);
      }
    }

    // Shift and tasks not yet wired to Odoo planning module.
    // Return null so the dashboard knows these are unavailable (not mock data).

    const res = NextResponse.json({
      badges: {
        production: activeMoCount,
        contacts: pendingRegistrations,
      },
      production: {
        active: activeMoCount,
        due: dueMoCount,
        doneToday: doneTodayCount,
      },
      shift: null,
      tasks: null,
      pendingRegistrations,
    });
    res.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res;
  } catch (error: any) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load dashboard' },
      { status: 500 },
    );
  }
}
