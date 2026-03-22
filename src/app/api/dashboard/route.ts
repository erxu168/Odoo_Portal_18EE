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
      const activeMos = await odoo.searchRead(
        'mrp.production',
        [['state', 'in', ['confirmed', 'progress']]],
        ['id'],
        { limit: 200 },
      );
      activeMoCount = activeMos.length;

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const dueMos = await odoo.searchRead(
        'mrp.production',
        [
          ['state', 'in', ['confirmed', 'progress']],
          ['date_deadline', '<=', todayStr + ' 23:59:59'],
        ],
        ['id'],
        { limit: 200 },
      );
      dueMoCount = dueMos.length;

      const doneMos = await odoo.searchRead(
        'mrp.production',
        [
          ['state', '=', 'done'],
          ['date_finished', '>=', todayStr + ' 00:00:00'],
        ],
        ['id'],
        { limit: 200 },
      );
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

    return NextResponse.json({
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
  } catch (error: any) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load dashboard' },
      { status: 500 },
    );
  }
}
