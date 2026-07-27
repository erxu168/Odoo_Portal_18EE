/**
 * POST /api/shifts/overtime/decision
 * Manager-only. Approve or reject one overtime punch (keyed by hr.attendance id).
 * Body: { company_id, week, attendance_id, status: 'approved'|'rejected'|'pending', reason? }
 *
 * The overtime event is RE-DERIVED server-side before storing, so:
 *   - the attendance_id must currently be a real overtime event for this
 *     company/week (else 409 — the punch changed and is no longer overtime),
 *   - an approve/reject must match the minutes the manager actually saw
 *     (`expected_mins`); if the punch changed underneath (e.g. 30 → 180) we 409
 *     so they re-review rather than silently approve a different number, and
 *   - the stored minutes are the server's authoritative value, never the client's
 *     (so the "changed since decided" safety net can't be disabled by the caller).
 * Idempotent — re-deciding overwrites the prior decision. 'pending' clears it.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, serverError } from '../../_manager';
import { setOvertimeDecision, type OvertimeStatus } from '@/lib/shifts-db';
import { fetchOvertimeWeek } from '@/lib/shifts-overtime';

const STATUSES: OvertimeStatus[] = ['pending', 'approved', 'rejected'];

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const auth = requireManagerCompany(body.company_id);
  if (!auth.ok) return auth.res;

  const weekKey = resolveWeekKey(body.week);
  if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });

  const attendanceId =
    typeof body.attendance_id === 'number' ? body.attendance_id : parseInt(String(body.attendance_id ?? ''), 10);
  if (!Number.isInteger(attendanceId) || attendanceId <= 0) {
    return NextResponse.json({ error: 'attendance_id is required' }, { status: 400 });
  }

  const status = body.status as OvertimeStatus;
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: 'status must be approved, rejected or pending' }, { status: 400 });
  }

  const reason =
    typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  const expectedMins = Number.isInteger(body.expected_mins) ? (body.expected_mins as number) : null;
  // Approve/reject MUST state the minutes the caller reviewed, so we can 409 on a
  // change. Only undo/'pending' is exempt (nothing to match).
  if (status !== 'pending' && expectedMins === null) {
    return NextResponse.json({ error: 'expected_mins is required for approve/reject' }, { status: 400 });
  }

  try {
    // Re-derive: the event must still exist, and its minutes are authoritative.
    const week = await fetchOvertimeWeek(auth.companyId, weekKey);
    const event = week.rows.find(r => r.attendanceId === attendanceId);
    if (!event) {
      return NextResponse.json(
        { error: 'This overtime no longer exists — the clock-in or schedule changed. Refresh and try again.', code: 'not_current' },
        { status: 409 },
      );
    }
    // Approve/reject must match what the manager reviewed; a changed amount means
    // re-review (undo/'pending' has nothing to match, so it is exempt).
    if (status !== 'pending' && expectedMins !== null && event.overtimeMins !== expectedMins) {
      return NextResponse.json(
        {
          error: `This overtime changed to ${event.overtimeMins} min since you opened it. Refresh and review again.`,
          code: 'changed',
          overtimeMins: event.overtimeMins,
        },
        { status: 409 },
      );
    }

    setOvertimeDecision(auth.companyId, attendanceId, status, {
      reason,
      overtimeMins: event.overtimeMins, // server value, not the client's
      decidedBy: auth.user.id,
      decidedByName: auth.user.name,
    });
    return NextResponse.json({ ok: true, overtimeMins: event.overtimeMins });
  } catch (err: unknown) {
    return serverError('overtime/decision', err);
  }
}
