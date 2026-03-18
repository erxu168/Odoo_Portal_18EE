import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/dashboard
 * Returns badge counts and shift info for the dashboard.
 * Live data from Odoo where available, mock data for unbuilt modules.
 */
export async function GET() {
  try {
    const odoo = getOdoo();

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

      // Due today or overdue
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

      // Done today
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

    // ── Mock: shift info (until planning.slot is wired) ──
    const hour = new Date().getHours();
    let shiftName = 'Morning shift';
    let shiftStation = 'Kitchen';
    let shiftStart = '06:00';
    let shiftEnd = '14:00';
    let onShift = true;
    if (hour >= 14 && hour < 22) {
      shiftName = 'Evening shift';
      shiftStart = '16:00';
      shiftEnd = '23:00';
    } else if (hour >= 22 || hour < 6) {
      onShift = false;
    }

    // ── Mock: task counts (until restaurant.shift.task is wired) ──
    const tasks = {
      total: 4,
      done: 1,
      overdue: 1,
      items: [
        {
          id: 1, name: 'Clean deep fryer station',
          category: 'Evening prep', photoRequired: true,
          status: 'overdue', dueLabel: '15m overdue',
        },
        {
          id: 2, name: 'Check walk-in fridge temps',
          category: 'Food safety', photoRequired: false,
          status: 'due_soon', dueLabel: 'Due 19:00',
        },
        {
          id: 3, name: 'Restock sauce station',
          category: 'Evening prep', photoRequired: false,
          status: 'upcoming', dueLabel: '20:00',
        },
        {
          id: 4, name: 'Mise en place check',
          category: 'Opening', photoRequired: false,
          status: 'done', dueLabel: 'Done',
        },
      ],
    };

    return NextResponse.json({
      badges: {
        production: activeMoCount,
        shifts: 3,       // mock
        tasks: tasks.overdue,
        inventory: 0,    // mock
        repair: 1,       // mock
        purchase: 4,     // mock
        leave: 24,       // mock (days remaining)
        payroll: 0,
        contacts: 0,
        profile: 0,
        settings: 0,
      },
      production: {
        active: activeMoCount,
        due: dueMoCount,
        doneToday: doneTodayCount,
      },
      shift: {
        onShift,
        name: shiftName,
        station: shiftStation,
        start: shiftStart,
        end: shiftEnd,
      },
      tasks,
    });
  } catch (error: any) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load dashboard' },
      { status: 500 },
    );
  }
}
