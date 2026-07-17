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
  nowOdooUtc,
  weekKeyDays,
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
  'department_id',
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

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/**
 * 2026 German statutory minimum wage (€/h). Rises to €14.60 in 2027 — used ONLY
 * as a fallback when an employee has no contract wage on file. Real rate always
 * comes from hr.contract when present.
 */
export const MIN_WAGE_EUR = 13.9;
/** Minijob monthly earnings cap (€) — derived from the min wage (× ~130/3 h). */
export const MINIJOB_CAP_EUR = Math.round((MIN_WAGE_EUR * 130) / 3); // 603

/**
 * Does a person's skill level meet an open shift's minimum?
 * Levels: '1' < '2' < '3'. null/'1' minimum = anyone.
 * A person with no skill set counts as level 1 (only qualifies for "anyone").
 */
export function meetsMinSkill(personSkill: '1' | '2' | '3' | null, minSkill: string | null): boolean {
  if (!minSkill || minSkill === '1') return true;
  const need = Number(minSkill);
  const have = personSkill ? Number(personSkill) : 1;
  return have >= need;
}

/** Hourly rate from an hr.contract row: hourly wage direct, else monthly→hourly. */
function contractHourlyRate(c: OdooRow): number {
  if (c.wage_type === 'hourly' && num(c.hourly_wage) > 0) return num(c.hourly_wage);
  const monthly = num(c.wage);
  const weekly = num(c.kw_agreed_weekly_hours);
  if (monthly > 0 && weekly > 0) {
    return Math.round(((monthly * 12) / (weekly * 52)) * 100) / 100;
  }
  return MIN_WAGE_EUR;
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
    departmentId: m2oId(row.department_id),
    departmentName: m2oName(row.department_id),
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

/** Published, ASSIGNED, future shifts for a company (soonest first). */
export async function fetchFutureAssignedSlots(companyId: number): Promise<ShiftSlot[]> {
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['state', '=', 'published'],
      ['resource_id', '!=', false],
      ['start_datetime', '>', nowOdooUtc()],
    ],
    SLOT_FIELDS,
    { limit: 1000, order: 'start_datetime asc, id asc' },
  )) as OdooRow[];
  return rows.map(mapSlot);
}

/**
 * Every future ASSIGNED shift (draft AND published) for one employee, soonest
 * first. Unlike fetchFutureAssignedSlots this is per-employee and includes
 * drafts — used by the "remove a person from all upcoming shifts" flow.
 */
export async function fetchEmployeeUpcomingAssignedSlots(
  companyId: number,
  employeeId: number,
): Promise<ShiftSlot[]> {
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['employee_id', '=', employeeId],
      ['start_datetime', '>=', nowOdooUtc()],
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
  const domain = [
    ['active', '=', true],
    ['company_id', '=', companyId],
  ];
  const baseFields = ['name', 'resource_id', 'department_id', 'contract_id'];
  // These three custom fields only exist where the krawings_shift_selfservice addon
  // is installed. Read them optionally: on an Odoo WITHOUT the addon (e.g. a portal
  // deploy that lands before the addon update, as on production) the fallback must
  // request ONLY standard fields so the roster still loads — caps/skill/employment
  // then simply default to empty downstream instead of 500-ing the whole screen.
  const optionalFields = ['x_max_weekly_hours', 'x_skill_level', 'x_employment_type'];
  let rows: OdooRow[];
  try {
    rows = (await odoo.searchRead('hr.employee', domain, [...baseFields, ...optionalFields], {
      limit: 500,
      order: 'name asc',
    })) as OdooRow[];
  } catch {
    rows = (await odoo.searchRead('hr.employee', domain, baseFields, {
      limit: 500,
      order: 'name asc',
    })) as OdooRow[];
  }

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

  // Batch-read current-contract hourly rate + contracted weekly hours (WAJ staff
  // have no contract → rate falls back, target stays null).
  const contractIds = rows
    .map(r => m2oId(r.contract_id))
    .filter((id): id is number => id !== null);
  const rateMap = new Map<number, number>();
  const targetMap = new Map<number, number>();
  if (contractIds.length > 0) {
    const contracts = (await odoo.read('hr.contract', contractIds,
      ['wage', 'wage_type', 'hourly_wage', 'kw_agreed_weekly_hours'])) as OdooRow[];
    for (const c of contracts) {
      rateMap.set(c.id as number, contractHourlyRate(c));
      const weekly = num(c.kw_agreed_weekly_hours);
      if (weekly > 0) targetMap.set(c.id as number, weekly);
    }
  }

  return rows.map(r => {
    const resourceId = m2oId(r.resource_id);
    const capRaw = typeof r.x_max_weekly_hours === 'number' ? r.x_max_weekly_hours : 0;
    const skillRaw = r.x_skill_level;
    const et = r.x_employment_type;
    const contractId = m2oId(r.contract_id);
    return {
      id: r.id as number,
      name: str(r.name),
      resourceId,
      departmentId: m2oId(r.department_id),
      departmentName: m2oName(r.department_id),
      cap: capRaw > 0 ? capRaw : null,
      skill: skillRaw === '1' || skillRaw === '2' || skillRaw === '3' ? skillRaw : null,
      roleIds: resourceId !== null ? roleMap.get(resourceId) ?? [] : [],
      employmentType:
        et === 'minijob' || et === 'midijob' || et === 'fulltime' ? et : null,
      weeklyTarget: contractId !== null ? targetMap.get(contractId) ?? null : null,
      hourlyRate: contractId !== null ? rateMap.get(contractId) ?? MIN_WAGE_EUR : MIN_WAGE_EUR,
      hasContract: contractId !== null,
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

/** hr.department list for the company (company-specific + shared departments). */
export async function fetchDepartments(companyId: number): Promise<{ id: number; name: string }[]> {
  const rows = (await getOdoo().searchRead(
    'hr.department',
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
  // NOTE: planning.slot.department_id is a readonly related field
  // (employee_id.department_id) — it cannot be written. The manager's chosen
  // department is stored portal-side (shift_slot_department) instead.
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
  if (v.resourceId !== undefined) {
    vals.resource_id = v.resourceId ? v.resourceId : false;
    // An open (unassigned) shift can never be over-cap — there is no assignee.
    // Clear any stale flag inline so the now-open slot doesn't render red;
    // recompute (driven by callers) reads only assigned slots and so can't.
    if (!v.resourceId) vals.x_over_cap_flag = false;
  }
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
 * One employee's total assigned hours in a Berlin calendar month.
 * refDate ("YYYY-MM-DD", Berlin) selects the month; defaults to the current
 * month. Used for the monthly hour-cap check and the Minijob €-cap view.
 */
export async function employeeMonthHours(employeeId: number, refDate?: string): Promise<number> {
  const today = refDate || berlinParts(nowOdooUtc()).date;
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${y}-${pad(m)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const startOdoo = berlinDateTimeToUtcOdoo(first, '00:00');
  const endOdoo = berlinDateTimeToUtcOdoo(next, '00:00');
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
    const s = str(r.start_datetime);
    const e = str(r.end_datetime);
    return s && e ? sum + durationHours(s, e) : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Employee ids with APPROVED (state='validate') time-off overlapping the given
 * Berlin date range (inclusive "YYYY-MM-DD"). Used so the weekend rule doesn't
 * count or gate people who are away.
 */
export async function onLeaveEmployeeIds(
  employeeIds: number[],
  startDate: string,
  endDate: string,
): Promise<Set<number>> {
  const out = new Set<number>();
  if (employeeIds.length === 0) return out;
  const rows = (await getOdoo().searchRead(
    'hr.leave',
    [
      ['employee_id', 'in', employeeIds],
      ['state', '=', 'validate'],
      ['request_date_from', '<=', endDate],
      ['request_date_to', '>=', startDate],
    ],
    ['employee_id'],
    { limit: 1000 },
  )) as OdooRow[];
  for (const r of rows) {
    const eid = Array.isArray(r.employee_id) && typeof r.employee_id[0] === 'number' ? r.employee_id[0] : null;
    if (eid !== null) out.add(eid);
  }
  return out;
}

/** employeeId → assigned hours in the current Berlin calendar month (for Minijob €-cap checks). */
export async function monthHoursMap(companyId: number): Promise<Map<number, number>> {
  const today = berlinParts(nowOdooUtc()).date;
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${y}-${pad(m)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const startOdoo = berlinDateTimeToUtcOdoo(first, '00:00');
  const endOdoo = berlinDateTimeToUtcOdoo(next, '00:00');
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['start_datetime', '>=', startOdoo],
      ['start_datetime', '<', endOdoo],
      ['resource_id', '!=', false],
    ],
    ['start_datetime', 'end_datetime', 'employee_id'],
    { limit: 2000 },
  )) as OdooRow[];
  const map = new Map<number, number>();
  for (const r of rows) {
    const eid = m2oId(r.employee_id);
    if (eid === null) continue;
    const s = str(r.start_datetime);
    const e = str(r.end_datetime);
    if (s && e) map.set(eid, (map.get(eid) ?? 0) + durationHours(s, e));
  }
  map.forEach((v, k) => map.set(k, Math.round(v * 100) / 100));
  return map;
}

/** Assigned slots (published + draft) for the Berlin calendar month of refDate ("YYYY-MM-DD"). */
async function fetchAssignedMonthSlots(companyId: number, refDate: string): Promise<ShiftSlot[]> {
  const [y, m] = refDate.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${y}-${pad(m)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const startOdoo = berlinDateTimeToUtcOdoo(first, '00:00');
  const endOdoo = berlinDateTimeToUtcOdoo(next, '00:00');
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['company_id', '=', companyId],
      ['start_datetime', '>=', startOdoo],
      ['start_datetime', '<', endOdoo],
      ['resource_id', '!=', false],
    ],
    SLOT_FIELDS,
    { limit: 2000 },
  )) as OdooRow[];
  return rows.map(mapSlot);
}

/**
 * Recompute x_over_cap_flag for one Berlin calendar month.
 * The hour cap (hr.employee.x_max_weekly_hours) is a MONTHLY limit, so over-cap
 * is judged on each employee's whole-month assigned total. Flags EVERY assigned
 * slot of an over-cap person-month (no/zero cap → clear). Writes only slots whose
 * current flag differs, batched per flag value. When employeeIds is given, only
 * those employees' slots are written (month totals are still computed live).
 */
async function recomputeMonthFlags(
  companyId: number,
  refDate: string,
  employeeIds?: number[],
): Promise<void> {
  const odoo = getOdoo();
  const slots = await fetchAssignedMonthSlots(companyId, refDate);

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
  // Cap lives on a custom field that may be absent (addon not installed) — if so,
  // treat everyone as uncapped rather than crashing the flag recompute.
  let caps: OdooRow[] = [];
  try {
    caps = (await odoo.searchRead(
      'hr.employee',
      [['id', 'in', empIds]],
      ['x_max_weekly_hours'],
      { limit: empIds.length },
    )) as OdooRow[];
  } catch {
    caps = [];
  }
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

/**
 * Recompute x_over_cap_flag after a change in the given week.
 * The cap is MONTHLY, so this recomputes every calendar month the week touches
 * (a week can straddle two months) — see recomputeMonthFlags. Signature kept
 * week-based for its many callers. Call after every mutation that changes
 * assignment or times.
 */
export async function recomputeWeekFlags(
  companyId: number,
  weekKey: string,
  employeeIds?: number[],
): Promise<void> {
  const days = weekKeyDays(weekKey); // Mon..Sun ("YYYY-MM-DD")
  const monthRefs = Array.from(new Set([days[0].slice(0, 7), days[6].slice(0, 7)])).map(mk => `${mk}-01`);
  for (const refDate of monthRefs) {
    await recomputeMonthFlags(companyId, refDate, employeeIds);
  }
}
