/**
 * GET /api/shifts/me?company_id=
 *
 * Self-service KPI bundle for the staff Planning dashboard (any logged-in
 * employee). Everything the staff KPI stack needs in one call:
 *   - nextShift + how many more shifts this week
 *   - this week's hours vs the personal limit (contracted target for a fixed
 *     contract, weekly cap for minijob/hourly)
 *   - this month's hours vs the €603 Minijob cap (or monthly contracted target),
 *     with an estimated-earnings figure
 *   - open shifts the viewer is eligible to claim
 *   - the viewer's own pending cover/swap requests
 *   - a light self-punctuality summary (on-time %) for the current week
 *
 * All hours are computed live from planning.slot (duration = end − start, never
 * allocated_hours). Reads only the viewer's own data — no manager scope.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listCoverRequests, slotMinSkills } from '@/lib/shifts-db';
import { getOdoo } from '@/lib/odoo';
import {
  employeeMonthHours,
  employeeWeekHours,
  fetchEmployees,
  meetsMinSkill,
  MIN_WAGE_EUR,
  MINIJOB_CAP_EUR,
} from '@/lib/shifts-odoo';
import {
  berlinISOWeekKey,
  berlinParts,
  currentWeekKey,
  fmtDay,
  fmtTimeRange,
  nowOdooUtc,
  odooToDate,
  weekKeyToUtcRange,
} from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

type OdooRow = Record<string, unknown>;

function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}
function m2oName(v: unknown): string {
  return Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '';
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "YYYY-MM-DD" + 1 day (pure calendar arithmetic). */
function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = parseInt(searchParams.get('company_id') || '', 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id is required' }, { status: 400 });
  }
  if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(companyId)) {
    return NextResponse.json({ error: 'You do not have access to this company' }, { status: 403 });
  }
  if (user.employee_id === null) {
    return NextResponse.json(
      { error: 'Your account is not linked to an employee record' },
      { status: 400 },
    );
  }
  const employeeId = user.employee_id;

  try {
    const odoo = getOdoo();
    const weekKey = currentWeekKey();
    const now = nowOdooUtc();

    const [employees, weekHours, monthHours, futureRows, openRows] = await Promise.all([
      fetchEmployees(companyId),
      employeeWeekHours(employeeId, weekKey),
      employeeMonthHours(employeeId),
      // My upcoming published shifts (this + next weeks) for "next shift".
      odoo.searchRead(
        'planning.slot',
        [
          ['company_id', '=', companyId],
          ['employee_id', '=', employeeId],
          ['state', '=', 'published'],
          ['start_datetime', '>', now],
        ],
        ['start_datetime', 'end_datetime', 'role_id'],
        { limit: 50, order: 'start_datetime asc, id asc' },
      ) as Promise<OdooRow[]>,
      // Open published future shifts — eligibility filtered below.
      odoo.searchRead(
        'planning.slot',
        [
          ['company_id', '=', companyId],
          ['state', '=', 'published'],
          ['resource_id', '=', false],
          ['start_datetime', '>', now],
        ],
        ['role_id'],
        { limit: 500 },
      ) as Promise<OdooRow[]>,
    ]);

    const me = employees.find(e => e.id === employeeId);
    const rate = me?.hourlyRate ?? MIN_WAGE_EUR;
    const employmentType = me?.employmentType ?? null;
    const cap = me?.cap ?? null;
    const weeklyTarget = me?.weeklyTarget ?? null;

    // --- Next shift + more-this-week ------------------------------------------
    const todayDate = berlinParts(now).date;
    const tomorrowDate = nextDate(todayDate);
    let nextShift: {
      day: string;
      timeRange: string;
      roleName: string;
      start: string;
      when: 'today' | 'tomorrow' | 'later';
    } | null = null;
    if (futureRows.length > 0) {
      const r = futureRows[0];
      const start = str(r.start_datetime);
      const end = str(r.end_datetime);
      const d = berlinParts(start).date;
      nextShift = {
        day: fmtDay(start),
        timeRange: fmtTimeRange(start, end),
        roleName: m2oName(r.role_id),
        start,
        when: d === todayDate ? 'today' : d === tomorrowDate ? 'tomorrow' : 'later',
      };
    }
    const moreThisWeek = futureRows
      .slice(1)
      .filter(r => berlinISOWeekKey(str(r.start_datetime)) === weekKey).length;

    // --- Weekly hours vs personal limit ---------------------------------------
    let weekly: { hours: number; limit: number | null; kind: 'target' | 'cap' | 'none' };
    if (weeklyTarget && weeklyTarget > 0) {
      weekly = { hours: weekHours, limit: weeklyTarget, kind: 'target' };
    } else if (cap && cap > 0) {
      weekly = { hours: weekHours, limit: cap, kind: 'cap' };
    } else if (employmentType === 'minijob' && rate > 0) {
      // No explicit weekly cap → derive a soft weekly ceiling from the €603 month cap.
      weekly = { hours: weekHours, limit: round1(MINIJOB_CAP_EUR / rate / 4.345), kind: 'cap' };
    } else {
      weekly = { hours: weekHours, limit: null, kind: 'none' };
    }

    // --- Monthly hours vs cap / target + estimated earnings -------------------
    const monthEur = round2(monthHours * rate);
    let monthly: {
      hours: number;
      eurUsed: number;
      eurLimit: number | null;
      hoursLimit: number | null;
      kind: 'cap' | 'target' | 'none';
      estEarnings: number;
    };
    if (employmentType === 'minijob') {
      monthly = {
        hours: monthHours,
        eurUsed: monthEur,
        eurLimit: MINIJOB_CAP_EUR,
        hoursLimit: rate > 0 ? round1(MINIJOB_CAP_EUR / rate) : null,
        kind: 'cap',
        estEarnings: monthEur,
      };
    } else if (weeklyTarget && weeklyTarget > 0) {
      monthly = {
        hours: monthHours,
        eurUsed: monthEur,
        eurLimit: null,
        hoursLimit: round1((weeklyTarget * 52) / 12),
        kind: 'target',
        estEarnings: monthEur,
      };
    } else {
      monthly = {
        hours: monthHours,
        eurUsed: monthEur,
        eurLimit: null,
        hoursLimit: null,
        kind: 'none',
        estEarnings: monthEur,
      };
    }

    // --- Open shifts I can claim (role + skill gate) --------------------------
    let openEligible = 0;
    if (me && me.resourceId !== null) {
      const minSkillMap = slotMinSkills(companyId, openRows.map(r => r.id as number));
      openEligible = openRows.filter(r => {
        const roleId = m2oId(r.role_id);
        const roleOk = roleId === null || me.roleIds.includes(roleId);
        return roleOk && meetsMinSkill(me.skill, minSkillMap.get(r.id as number) ?? null);
      }).length;
    }

    // --- My pending cover / swap requests (glance count) ----------------------
    const outgoing = listCoverRequests({
      companyId,
      fromEmployeeId: employeeId,
      status: ['pending_teammate', 'pending_manager'],
    });
    const requests = {
      pending: outgoing.length,
      awaitingTeammate: outgoing.filter(r => r.status === 'pending_teammate').length,
      awaitingManager: outgoing.filter(r => r.status === 'pending_manager').length,
    };

    // --- Self punctuality this week (targeted, own attendance only) -----------
    let punctuality: {
      matched: number;
      lateCount: number;
      earlyCount: number;
      onTimePct: number | null;
    } | null = null;
    try {
      const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
      const attRows = (await odoo.searchRead(
        'hr.attendance',
        [
          ['employee_id', '=', employeeId],
          ['check_in', '>=', startOdoo],
          ['check_in', '<', endOdoo],
        ],
        ['check_in', 'check_out', 'planning_slot_id'],
        { limit: 200, order: 'check_in asc' },
      )) as OdooRow[];
      const slotIds = Array.from(
        new Set(attRows.map(r => m2oId(r.planning_slot_id)).filter((v): v is number => v !== null)),
      );
      const slotMap = new Map<number, { start: string; end: string }>();
      if (slotIds.length > 0) {
        const srows = (await odoo.read('planning.slot', slotIds, [
          'start_datetime',
          'end_datetime',
        ])) as OdooRow[];
        for (const s of srows) {
          slotMap.set(s.id as number, { start: str(s.start_datetime), end: str(s.end_datetime) });
        }
      }
      let matched = 0;
      let lateCount = 0;
      let earlyCount = 0;
      for (const r of attRows) {
        const sid = m2oId(r.planning_slot_id);
        const slot = sid !== null ? slotMap.get(sid) : undefined;
        if (!slot || !slot.start) continue;
        matched++;
        const lateMin = Math.round(
          (odooToDate(str(r.check_in)).getTime() - odooToDate(slot.start).getTime()) / 60000,
        );
        if (lateMin > 0) lateCount++;
        const checkOut = r.check_out ? str(r.check_out) : '';
        if (checkOut && slot.end) {
          const diff = Math.round(
            (odooToDate(checkOut).getTime() - odooToDate(slot.end).getTime()) / 60000,
          );
          if (diff < 0) earlyCount++;
        }
      }
      punctuality =
        matched > 0
          ? {
              matched,
              lateCount,
              earlyCount,
              onTimePct: Math.round(((matched - lateCount) / matched) * 100),
            }
          : { matched: 0, lateCount: 0, earlyCount: 0, onTimePct: null };
    } catch {
      punctuality = null; // punctuality is secondary — never let it fail the dashboard
    }

    return NextResponse.json({
      employeeId,
      employmentType,
      hourlyRate: rate,
      hasContract: me?.hasContract ?? false,
      nextShift,
      moreThisWeek,
      weekly,
      monthly,
      openEligible,
      requests,
      punctuality,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] me failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load your dashboard' }, { status: 500 });
  }
}
