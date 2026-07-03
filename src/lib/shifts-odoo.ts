/**
 * Shifts module — Odoo planning.slot access layer.
 *
 * Hard facts (introspected on Odoo 18 EE staging, uid=2):
 * - planning.slot fields: start_datetime / end_datetime (UTC-naive strings),
 *   role_id (m2o planning.role), resource_id (m2o resource.resource — the WRITE
 *   target for assignment; false = open), employee_id (READONLY related — reads
 *   only), state ('draft'|'published', directly writable), company_id (required),
 *   name (text — shift note), x_over_cap_flag (bool, stored, portal-managed).
 * - NEVER read or write allocated_hours: Odoo computes it from the company
 *   working calendar and recomputes it on every resource_id change; writing it
 *   corrupts allocated_percentage. Duration = end − start, computed portal-side.
 * - Week bucketing: ISO week (Mon–Sun) of start_datetime in Berlin wall clock.
 */
import { getOdoo } from '@/lib/odoo';
import {
  berlinDateTimeToUtcOdoo,
  berlinParts,
  durationHours,
  weekKeyToUtcRange,
} from '@/lib/shifts-time';
import type { ShiftEmployee, ShiftSlot } from '@/types/shifts';

export type { ShiftEmployee, ShiftSlot } from '@/types/shifts';

const SLOT_FIELDS = [
  'start_datetime',
  'end_datetime',
  'state',
  'role_id',
  'resource_id',
  'employee_id',
  'name',
  'company_id',
  'x_over_cap_flag',
];

type OdooRow = Record<string, unknown>;

/** Odoo many2one comes back as [id, display_name] or false. */
function m2oId(v: unknown): number | null {
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

function m2oName(v: unknown): string {
  return Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function mapSlot(row: OdooRow): ShiftSlot {
  const start = str(row.start_datetime);
  const end = str(row.end_datetime);
  return {
    id: row.id as number,
    start,
    end,
    state: row.state === 'published' ? 'published' : 'draft',
    roleId: m2oId(row.role_id),
    roleName: m2oName(row.role_id),
    resourceId: m2oId(row.resource_id),
    employeeId: m2oId(row.employee_id),
    employeeName: m2oName(row.employee_id),
    note: str(row.name),
    overCap: row.x_over_cap_flag === true,
    hours: start && end ? durationHours(start, end) : 0,
    companyId: m2oId(row.company_id) ?? 0,
  };
}

/** "YYYY-MM-DD" + N days (pure calendar arithmetic). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// -- Reads ------------------------------------------------------------------------

/** All slots of a company whose Berlin-week is weekKey, ordered by start. */
export async function fetchWeekSlots(companyId: number, weekKey: string): Promise<ShiftSlot[]> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['start_datetime', '>=', startOdoo],
      ['start_datetime', '<', endOdoo],
    ],
    SLOT_FIELDS,
    { limit: 1000, order: 'start_datetime asc, id asc' },
  )) as OdooRow[];
  return rows.map(mapSlot);
}

/** One slot by id, or null when it no longer exists. */
export async function fetchSlot(id: number): Promise<ShiftSlot | null> {
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [['id', '=', id]],
    SLOT_FIELDS,
    { limit: 1 },
  )) as OdooRow[];
  return rows.length > 0 ? mapSlot(rows[0]) : null;
}

/** Active employees of the company with resource, caps, skills and roles resolved. */
export async function fetchEmployees(companyId: number): Promise<ShiftEmployee[]> {
  const odoo = getOdoo();
  const rows = (await odoo.searchRead(
    'hr.employee',
    [
      ['active', '=', true],
      ['company_id', '=', companyId],
    ],
    ['name', 'resource_id', 'department_id', 'x_max_weekly_hours', 'x_skill_level'],
    { limit: 500, order: 'name asc' },
  )) as OdooRow[];

  // Batch-read resource.resource.role_ids (m2m) → "Can work as".
  const resourceIds = rows
    .map(r => m2oId(r.resource_id))
    .filter((id): id is number => id !== null);
  const roleMap = new Map<number, number[]>();
  if (resourceIds.length > 0) {
    const resources = (await odoo.read('resource.resource', resourceIds, ['role_ids'])) as OdooRow[];
    for (const res of resources) {
      const ids = Array.isArray(res.role_ids)
        ? (res.role_ids as unknown[]).filter((x): x is number => typeof x === 'number')
        : [];
      roleMap.set(res.id as number, ids);
    }
  }

  return rows.map(r => {
    const resourceId = m2oId(r.resource_id);
    const capRaw = typeof r.x_max_weekly_hours === 'number' ? r.x_max_weekly_hours : 0;
    const skillRaw = r.x_skill_level;
    return {
      id: r.id as number,
      name: str(r.name),
      resourceId,
      departmentId: m2oId(r.department_id),
      departmentName: m2oName(r.department_id),
      cap: capRaw > 0 ? capRaw : null,
      skill: skillRaw === '1' || skillRaw === '2' || skillRaw === '3' ? skillRaw : null,
      roleIds: resourceId !== null ? roleMap.get(resourceId) ?? [] : [],
    };
  });
}

/** planning.role list for the company (company-specific + shared roles). */
export async function fetchRoles(companyId: number): Promise<{ id: number; name: string }[]> {
  const rows = (await getOdoo().searchRead(
    'planning.role',
    ['|', ['company_id', '=', companyId], ['company_id', '=', false]],
    ['name'],
    { limit: 200, order: 'name asc' },
  )) as OdooRow[];
  return rows.map(r => ({ id: r.id as number, name: str(r.name) }));
}

// -- Writes -----------------------------------------------------------------------

/**
 * Create a draft slot from Berlin wall-clock inputs.
 * Overnight shifts: end <= start → the shift ends on the NEXT day.
 */
export async function createSlot(v: {
  companyId: number;
  date: string;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  resourceId: number | null;
  note: string;
}): Promise<number> {
  const endDate = v.endHHMM <= v.startHHMM ? addDays(v.date, 1) : v.date;
  const vals: Record<string, unknown> = {
    company_id: v.companyId,
    start_datetime: berlinDateTimeToUtcOdoo(v.date, v.startHHMM),
    end_datetime: berlinDateTimeToUtcOdoo(endDate, v.endHHMM),
    role_id: v.roleId ?? false,
    resource_id: v.resourceId ?? false,
    name: v.note || false,
    state: 'draft',
  };
  return (await getOdoo().create('planning.slot', vals, {
    context: { company_id: v.companyId, allowed_company_ids: [v.companyId] },
  })) as number;
}

/**
 * Update a slot. Time fields are Berlin wall clock; when any of date/startHHMM/
 * endHHMM changes, the missing parts are taken from the live slot and the
 * overnight rule (end <= start → next day) is re-applied.
 * resourceId: number assigns, null/false unassigns (open shift).
 */
export async function updateSlot(
  id: number,
  v: Partial<{
    date: string;
    startHHMM: string;
    endHHMM: string;
    roleId: number | null;
    resourceId: number | null | false;
    note: string;
    state: 'draft' | 'published';
  }>,
): Promise<void> {
  const vals: Record<string, unknown> = {};

  if (v.date !== undefined || v.startHHMM !== undefined || v.endHHMM !== undefined) {
    const slot = await fetchSlot(id);
    if (!slot) throw new Error(`[shifts] Slot ${id} not found`);
    const curStart = berlinParts(slot.start);
    const curEnd = berlinParts(slot.end);
    const date = v.date ?? curStart.date;
    const startHHMM = v.startHHMM ?? curStart.hhmm;
    const endHHMM = v.endHHMM ?? curEnd.hhmm;
    const endDate = endHHMM <= startHHMM ? addDays(date, 1) : date;
    vals.start_datetime = berlinDateTimeToUtcOdoo(date, startHHMM);
    vals.end_datetime = berlinDateTimeToUtcOdoo(endDate, endHHMM);
  }
  if (v.roleId !== undefined) vals.role_id = v.roleId ?? false;
  if (v.resourceId !== undefined) vals.resource_id = v.resourceId ? v.resourceId : false;
  if (v.note !== undefined) vals.name = v.note || false;
  if (v.state !== undefined) vals.state = v.state;

  if (Object.keys(vals).length === 0) return;
  await getOdoo().write('planning.slot', [id], vals);
}

export async function deleteSlot(id: number): Promise<void> {
  await getOdoo().unlink('planning.slot', [id]);
}

// -- Week hours (always computed live, never persisted as facts) -------------------

async function fetchAssignedWeekSlots(companyId: number, weekKey: string): Promise<ShiftSlot[]> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['start_datetime', '>=', startOdoo],
      ['start_datetime', '<', endOdoo],
      ['resource_id', '!=', false],
    ],
    SLOT_FIELDS,
    { limit: 1000 },
  )) as OdooRow[];
  return rows.map(mapSlot);
}

/** employeeId → total hours in the week (published + draft, assigned slots). */
export async function weekHoursMap(companyId: number, weekKey: string): Promise<Map<number, number>> {
  const slots = await fetchAssignedWeekSlots(companyId, weekKey);
  const totals = new Map<number, number>();
  for (const slot of slots) {
    if (slot.employeeId === null) continue;
    totals.set(slot.employeeId, (totals.get(slot.employeeId) ?? 0) + slot.hours);
  }
  totals.forEach((total, empId) => {
    totals.set(empId, Math.round(total * 100) / 100);
  });
  return totals;
}

/** One employee's total assigned hours (published + draft) in the week. */
export async function employeeWeekHours(employeeId: number, weekKey: string): Promise<number> {
  const { startOdoo, endOdoo } = weekKeyToUtcRange(weekKey);
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['employee_id', '=', employeeId],
      ['start_datetime', '>=', startOdoo],
      ['start_datetime', '<', endOdoo],
    ],
    ['start_datetime', 'end_datetime'],
    { limit: 1000 },
  )) as OdooRow[];
  const total = rows.reduce((sum, r) => {
    const start = str(r.start_datetime);
    const end = str(r.end_datetime);
    return start && end ? sum + durationHours(start, end) : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Recompute x_over_cap_flag for a company-week.
 * Flags EVERY slot of an over-cap person-week (cap from live x_max_weekly_hours;
 * no cap → clear). Writes only slots whose current flag differs, batched per
 * flag value (one write for true, one for false). When employeeIds is given,
 * only those employees' slots are touched; totals are still computed live.
 * Call after every mutation that changes assignment or times.
 */
export async function recomputeWeekFlags(
  companyId: number,
  weekKey: string,
  employeeIds?: number[],
): Promise<void> {
  const odoo = getOdoo();
  const slots = await fetchAssignedWeekSlots(companyId, weekKey);

  const byEmployee = new Map<number, { total: number; slots: { id: number; flag: boolean }[] }>();
  for (const slot of slots) {
    if (slot.employeeId === null) continue;
    const entry = byEmployee.get(slot.employeeId) ?? { total: 0, slots: [] };
    entry.total += slot.hours;
    entry.slots.push({ id: slot.id, flag: slot.overCap });
    byEmployee.set(slot.employeeId, entry);
  }
  if (byEmployee.size === 0) return;

  // Read caps live for the employees involved.
  const empIds = Array.from(byEmployee.keys());
  const caps = (await odoo.searchRead(
    'hr.employee',
    [['id', 'in', empIds]],
    ['x_max_weekly_hours'],
    { limit: empIds.length },
  )) as OdooRow[];
  const capMap = new Map<number, number>();
  for (const c of caps) {
    capMap.set(c.id as number, typeof c.x_max_weekly_hours === 'number' ? c.x_max_weekly_hours : 0);
  }

  const only = employeeIds ? new Set(employeeIds) : null;
  const setTrue: number[] = [];
  const setFalse: number[] = [];
  byEmployee.forEach((entry, empId) => {
    if (only && !only.has(empId)) return;
    const cap = capMap.get(empId) ?? 0;
    const over = cap > 0 && entry.total > cap + 1e-9;
    for (const s of entry.slots) {
      if (s.flag !== over) (over ? setTrue : setFalse).push(s.id);
    }
  });

  if (setTrue.length > 0) await odoo.write('planning.slot', setTrue, { x_over_cap_flag: true });
  if (setFalse.length > 0) await odoo.write('planning.slot', setFalse, { x_over_cap_flag: false });
}
