/**
 * GET /api/shifts/summary?company_id=
 *
 * Dashboard tile counts for the shifts module.
 * Staff counts: open eligible shifts, my upcoming shifts, incoming requests.
 * Manager counts (hasRole manager): approvals (pending covers + open sick
 * reports), open shift count, at-risk (open sick reports). Plus the settings
 * subset the dashboard needs.
 *
 * GET routes apply lazyExpireIfDue to any pending requests they touch.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { confirmedSlotIds, getShiftSettings, listCoverRequests, listSickReports, slotMinSkills } from '@/lib/shifts-db';
import { lazyExpireIfDue } from '@/lib/shifts-guards';
import { fetchEmployees, fetchFutureAssignedSlots, fetchSlot, meetsMinSkill } from '@/lib/shifts-odoo';
import { nowOdooUtc } from '@/lib/shifts-time';
import type { CoverRequest, ShiftEmployee, ShiftSettings, ShiftSlot } from '@/types/shifts';

export const dynamic = 'force-dynamic';

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
  // Staff need an employee link; managers/admins without one still get their
  // manager counts (staff counts fall back to zero).
  if (user.employee_id === null && !hasRole(user, 'manager')) {
    return NextResponse.json(
      { error: 'Your account is not linked to an employee record' },
      { status: 400 },
    );
  }
  const employeeId = user.employee_id;

  try {
    const settings = getShiftSettings(companyId);
    const now = nowOdooUtc();

    const [openRows, employees] = await Promise.all([
      getOdoo().searchRead(
        'planning.slot',
        [
          ['company_id', '=', companyId],
          ['state', '=', 'published'],
          ['resource_id', '=', false],
          ['start_datetime', '>', now],
        ],
        ['role_id'],
        { limit: 1000 },
      ) as Promise<Record<string, unknown>[]>,
      fetchEmployees(companyId),
    ]);

    const me = employeeId !== null ? employees.find(e => e.id === employeeId) : undefined;

    // Staff: open eligible shifts (role + skill gate).
    let openCount = 0;
    if (me && me.resourceId !== null) {
      const minSkillMap = slotMinSkills(companyId, openRows.map(r => r.id as number));
      openCount = openRows.filter(r => {
        const roleId = Array.isArray(r.role_id) && typeof r.role_id[0] === 'number' ? r.role_id[0] : null;
        const roleOk = roleId === null || me.roleIds.includes(roleId);
        return roleOk && meetsMinSkill(me.skill, minSkillMap.get(r.id as number) ?? null);
      }).length;
    }

    // Staff: my upcoming published shifts.
    let mineCount = 0;
    if (employeeId !== null) {
      const mineRows = (await getOdoo().searchRead(
        'planning.slot',
        [
          ['company_id', '=', companyId],
          ['employee_id', '=', employeeId],
          ['state', '=', 'published'],
          ['start_datetime', '>', now],
        ],
        ['id'],
        { limit: 1000 },
      )) as Record<string, unknown>[];
      mineCount = mineRows.length;
    }

    // Staff: incoming pending requests (directed to me, or ask-all I am eligible for).
    let requestCount = 0;
    if (employeeId !== null) {
      const pending = listCoverRequests({ companyId, status: ['pending_teammate'] });
      const expired = await expirePending(pending, settings);
      // Act-now only: requests waiting on MY answer. Covers I accepted that are
      // waiting on the manager are shown inside the inbox, not as a red badge.
      requestCount = expired.filter(req => {
        if (req.status !== 'pending_teammate') return false;
        if (req.toEmployeeId === employeeId) return true;
        if (!req.askAll || req.fromEmployeeId === employeeId) return false;
        return isEligible(me, req.liveSlot, req.snapshotRoleId);
      }).length;
    }

    const body: {
      staff: { open: number; mine: number; requests: number };
      manager?: { approvals: number; openShifts: number; atRisk: number; unconfirmed: number };
      settings: { allowSickReport: boolean; allowAskAll: boolean; requireApproval: boolean };
    } = {
      staff: { open: openCount, mine: mineCount, requests: requestCount },
      settings: {
        allowSickReport: settings.allowSickReport,
        allowAskAll: settings.allowAskAll,
        requireApproval: settings.requireApproval,
      },
    };

    if (hasRole(user, 'manager')) {
      const pendingManager = listCoverRequests({ companyId, status: ['pending_manager'] });
      const expired = await expirePending(pendingManager, settings);
      const pendingCount = expired.filter(r => r.status === 'pending_manager').length;
      const sickOpen = listSickReports(companyId, 'open').length;
      // Unconfirmed only matters (and is only computed) when the feature is on,
      // so the tile badge stays 0 rather than showing every assigned shift.
      let unconfirmed = 0;
      if (settings.requireConfirmation) {
        const assigned = await fetchFutureAssignedSlots(companyId);
        const confirmed = confirmedSlotIds(companyId);
        unconfirmed = assigned.filter(s => !confirmed.has(s.id)).length;
      }
      body.manager = {
        approvals: pendingCount + sickOpen,
        openShifts: openRows.length,
        atRisk: sickOpen,
        unconfirmed,
      };
    }

    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[shifts] summary failed: ${msg}`);
    return NextResponse.json({ error: 'Could not load the shifts summary' }, { status: 500 });
  }
}

interface ExpiredEntry extends CoverRequest {
  liveSlot: ShiftSlot | null;
  snapshotRoleId: number | null;
}

/** Apply lazyExpireIfDue to pending requests (live slot read, deduped per slot). */
async function expirePending(reqs: CoverRequest[], settings: ShiftSettings): Promise<ExpiredEntry[]> {
  const slotIds = Array.from(new Set(reqs.map(r => r.slotId)));
  const slots = await Promise.all(slotIds.map(id => fetchSlot(id)));
  const slotById = new Map<number, ShiftSlot | null>();
  slotIds.forEach((id, i) => slotById.set(id, slots[i]));
  return reqs.map(req => {
    const liveSlot = slotById.get(req.slotId) ?? null;
    const current = lazyExpireIfDue(req, liveSlot, settings);
    return { ...current, liveSlot, snapshotRoleId: req.slotSnapshot.roleId };
  });
}

function isEligible(
  me: ShiftEmployee | undefined,
  slot: ShiftSlot | null,
  snapshotRoleId: number | null,
): boolean {
  if (!me || me.resourceId === null) return false;
  const roleId = slot ? slot.roleId : snapshotRoleId;
  return roleId === null || me.roleIds.includes(roleId);
}
