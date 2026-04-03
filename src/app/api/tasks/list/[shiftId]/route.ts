import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMyShifts, getTaskListForShift } from '@/lib/odoo-tasks';

interface RouteParams {
  params: { shiftId: string };
}

// GET /api/tasks/list/[shiftId]
// Returns the task list for a given planning.slot id
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const shiftId = parseInt(params.shiftId, 10);
    if (isNaN(shiftId)) return NextResponse.json({ error: 'Invalid shift id' }, { status: 400 });

    // Find the shift from today's list so we have start/end times for stub deadlines
    const employeeId = user.employee_id;
    let shift = null;

    if (employeeId) {
      const shifts = await getMyShifts(employeeId);
      shift = shifts.find(s => s.id === shiftId) ?? null;
    }

    if (!shift) {
      return NextResponse.json({ taskList: null });
    }

    const taskList = await getTaskListForShift(shift);
    return NextResponse.json({ taskList });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load task list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
