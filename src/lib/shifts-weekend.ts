/**
 * Weekend quota engine — PURE logic (no I/O), unit-tested.
 *
 * Each staff member must claim an equal share of the weekend (Fri/Sat/Sun)
 * shifts before they may pick weekday shifts. The share is the total weekend
 * demand split across the people who can actually work it:
 *   quota = min( ceil(W_total / N) , (weekend slots this person is eligible for) )
 * The gate opens once the person has met their quota, OR once every weekend slot
 * is taken (collective coverage discharged), OR if the person isn't in the
 * eligible cohort at all. See docs/superpowers/specs/2026-07-08-smart-shift-planning-design.md.
 */

export const WEEKEND_DOWS = [5, 6, 7]; // ISO: Fri=5, Sat=6, Sun=7

/** True for Fri/Sat/Sun (ISO dow 1=Mon…7=Sun). */
export function isWeekendDow(dow: number): boolean {
  return dow >= 5 && dow <= 7;
}

export interface WeekendSlotLite {
  id: number;
  roleId: number | null;
  minSkill: '2' | '3' | null;
  /** resource.resource id of the assignee, or null when still open */
  resourceId: number | null;
}

export interface CohortEmp {
  id: number;
  resourceId: number | null;
  skill: '1' | '2' | '3' | null;
  roleIds: number[];
}

export interface WeekendGate {
  /** this person's minimum weekend shifts for the period */
  required: number;
  /** weekend shifts already assigned to them */
  done: number;
  /** required − done, floored at 0 */
  remaining: number;
  /** open (unassigned) weekend slots someone could still take */
  weekendSlotsAvailable: number;
  /** may they pick weekday shifts? */
  gateOpen: boolean;
  /** are they eligible+counted for the weekend duty? */
  inCohort: boolean;
}

/** Mirrors meetsMinSkill in shifts-odoo (kept local so this module stays pure). */
function skillMeets(personSkill: '1' | '2' | '3' | null, minSkill: '2' | '3' | null): boolean {
  if (!minSkill) return true;
  const need = Number(minSkill);
  const have = personSkill ? Number(personSkill) : 1;
  return have >= need;
}

function eligibleFor(emp: CohortEmp, slot: WeekendSlotLite): boolean {
  if (emp.resourceId === null) return false;
  if (slot.roleId !== null && !emp.roleIds.includes(slot.roleId)) return false;
  return skillMeets(emp.skill, slot.minSkill);
}

/**
 * Compute one person's weekend gate for a period's weekend slots.
 * `weekendSlots` = all published weekend (Fri/Sat/Sun) slots in the period
 * (assigned AND open). `cohort` = all active schedulable employees.
 */
export function computeWeekendGate(
  weekendSlots: WeekendSlotLite[],
  cohort: CohortEmp[],
  me: CohortEmp,
): WeekendGate {
  // Only slots at least one active person can legally work are an obligation.
  const claimable = weekendSlots.filter(s => cohort.some(e => eligibleFor(e, s)));
  const wTotal = claimable.length;
  const wUnassigned = claimable.filter(s => s.resourceId === null).length;

  // Cohort = people eligible for at least one weekend slot.
  const inCohortEmps = cohort.filter(e => e.resourceId !== null && claimable.some(s => eligibleFor(e, s)));
  const n = inCohortEmps.length;
  const inCohort = inCohortEmps.some(e => e.id === me.id);

  const base = n > 0 ? Math.ceil(wTotal / n) : 0;
  const myEligible = claimable.filter(s => eligibleFor(me, s)).length;
  const required = inCohort ? Math.min(base, myEligible) : 0;

  const done = me.resourceId === null
    ? 0
    : weekendSlots.filter(s => s.resourceId !== null && s.resourceId === me.resourceId).length;
  const remaining = Math.max(0, required - done);

  const gateOpen = remaining === 0 || wUnassigned === 0 || !inCohort;

  return { required, done, remaining, weekendSlotsAvailable: wUnassigned, gateOpen, inCohort };
}
