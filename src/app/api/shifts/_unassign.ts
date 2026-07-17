/**
 * Shifts module — shared bulk-unassign logic (colocated non-route helper).
 *
 * Unassign = clear planning.slot.resource_id so the shift becomes an OPEN
 * (unfilled) shift — it is NOT deleted. Batches the single-slot unassign from
 * slots/[id] PUT: per slot we invalidate any live cover request BEFORE the
 * write, set resource_id=null (updateSlot also clears the now-open slot's stale
 * x_over_cap_flag), then clear the confirmation + reminder dedup.
 *
 * Because the person's assigned hours DROP, x_over_cap_flag is recomputed for
 * each affected employee across every touched week (an over-cap flag may now
 * clear). Only PUBLISHED slots notify — staff can't see drafts — and each
 * distinct removed employee is told once (shift_changed) with a count.
 *
 * Robustness: each slot is re-read live and only unassigned when it still
 * exists and is still on the person we snapshotted — so a concurrent
 * reassignment can't make us remove the wrong person, and a slot deleted
 * mid-batch is skipped rather than aborting (and stranding) the whole run.
 */
import { clearConfirmation, clearConfirmReminders } from '@/lib/shifts-db';
import { invalidateActiveRequestsForSlot } from '@/lib/shifts-guards';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';

export interface UnassignResult {
  unassigned: number;
  weeks: number;
}

/**
 * Unassign every ASSIGNED slot in `slots` (open slots are ignored). Returns how
 * many were unassigned and how many distinct weeks were touched. Notifies each
 * distinct removed employee once (published slots only) unless `notify` is false.
 */
export async function unassignSlots(
  companyId: number,
  slots: ShiftSlot[],
  notify: boolean,
): Promise<UnassignResult> {
  const targets = slots.filter(s => s.employeeId !== null && s.resourceId !== null);
  if (targets.length === 0) return { unassigned: 0, weeks: 0 };

  // Per employee → the week keys whose over-cap flags must be recomputed.
  const weeksByEmployee = new Map<number, Set<string>>();
  // Per employee → their PUBLISHED removed slots, for one notification each.
  const publishedByEmployee = new Map<number, ShiftSlot[]>();
  let unassigned = 0;

  for (const snap of targets) {
    try {
      // Re-read live: only unassign when the slot still exists and is still on
      // the person we snapshotted (a concurrent reassignment or delete → skip).
      const slot = await fetchSlot(snap.id);
      if (!slot || slot.resourceId === null || slot.employeeId !== snap.employeeId) continue;

      // Mirror slots/[id]: invalidate the live cover request BEFORE the write.
      await invalidateActiveRequestsForSlot(slot.id, 'You were removed from this shift.');
      await updateSlot(slot.id, { resourceId: null });

      // The Odoo write is the commit point — record it BEFORE the local
      // confirmation cleanup, so a (sync) clear failure can't drop a committed
      // unassign from the count / notification / recompute.
      unassigned += 1;
      const empId = slot.employeeId as number;
      const wset = weeksByEmployee.get(empId) ?? new Set<string>();
      wset.add(berlinISOWeekKey(slot.start));
      weeksByEmployee.set(empId, wset);
      if (slot.state === 'published') {
        const list = publishedByEmployee.get(empId) ?? [];
        list.push(slot);
        publishedByEmployee.set(empId, list);
      }

      clearConfirmation(slot.id);
      clearConfirmReminders(slot.id);
    } catch (err: unknown) {
      // One bad slot must not abort the batch (or strand the others' notices).
      console.warn(
        `[shifts] unassign slot ${snap.id} failed (skipped):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (unassigned === 0) return { unassigned: 0, weeks: 0 };

  // The removed person's hours dropped in each touched week → recompute flags.
  // Best-effort: the unassign already committed, so a recompute failure must not
  // fail the request or block notifications (stale flags self-heal on the next
  // mutation).
  const allWeeks = new Set<string>();
  for (const [empId, wset] of Array.from(weeksByEmployee.entries())) {
    for (const wk of Array.from(wset)) {
      allWeeks.add(wk);
      try {
        await recomputeWeekFlags(companyId, wk, [empId]);
      } catch (err: unknown) {
        console.warn(
          `[shifts] unassign recompute (emp ${empId}, ${wk}) failed (ignored):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // One shift_changed per removed employee (published only). Best-effort AND
  // isolated per employee, so one failure can't skip the others.
  if (notify) {
    for (const [empId, list] of Array.from(publishedByEmployee.entries())) {
      const first = list[0];
      try {
        await notifyEmployee(empId, companyId, 'shift_changed', {
          day: fmtDay(first.start),
          time: fmtTimeRange(first.start, first.end),
          roleName: first.roleName,
          count: list.length,
          message:
            list.length === 1
              ? 'This shift is no longer yours — a manager removed you.'
              : `You were removed from ${list.length} shifts — a manager took you off them.`,
        });
      } catch (err: unknown) {
        console.warn(
          `[shifts] unassign notify (emp ${empId}) failed (ignored):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  return { unassigned, weeks: allWeeks.size };
}
