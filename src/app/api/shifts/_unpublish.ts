/**
 * Shifts module — shared unpublish logic (colocated non-route helper).
 *
 * Unpublish is the mirror of publish: a published planning.slot goes back to
 * 'draft' so staff stop seeing it, WITHOUT deleting it — Delete is the separate
 * "gone for good" path. Because the slot and its assignment survive, total
 * assigned hours are unchanged, so x_over_cap_flag never moves and NO week-flag
 * recompute is needed (unlike delete-series).
 *
 * Side-effects mirror a manager edit: any in-flight cover request on the slot is
 * invalidated (a draft shift can't have a live cover request) and any staff
 * confirmation ("I'll be there") + confirm-reminder dedup is cleared, so a later
 * republish starts a fresh confirmation cycle. Each distinct assigned employee
 * is notified once (shift_unpublished) unless silent.
 *
 * Ordering: cleanup (invalidate + clear confirmations) runs BEFORE the state
 * write, matching delete-series / slots[id]. Both cleanup steps are idempotent
 * and stay gated on state==='published' until the write lands, so a retry after
 * a mid-operation failure re-runs them safely — whereas writing draft first
 * would make a retry short-circuit (published→0) and orphan the pending request.
 */
import { getOdoo } from '@/lib/odoo';
import { clearConfirmation, clearConfirmReminders } from '@/lib/shifts-db';
import { invalidateActiveRequestsForSlot } from '@/lib/shifts-guards';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';

/**
 * Revert the PUBLISHED slots in `slots` back to draft (drafts are ignored, so
 * the call is idempotent). Returns how many slots were actually unpublished.
 * Notifies each distinct assigned employee once unless `notify` is false.
 */
export async function unpublishSlots(
  companyId: number,
  slots: ShiftSlot[],
  notify: boolean,
): Promise<number> {
  const published = slots.filter(s => s.state === 'published');
  if (published.length === 0) return 0;

  // Cleanup FIRST (idempotent + retry-safe): kill live cover requests (which
  // sends its own cover_invalidated notices) and void confirmations for every
  // slot about to leave the published schedule.
  for (const slot of published) {
    await invalidateActiveRequestsForSlot(slot.id, 'The shift was unpublished.');
    clearConfirmation(slot.id);
    clearConfirmReminders(slot.id);
  }

  await getOdoo().write('planning.slot', published.map(s => s.id), { state: 'draft' });

  // One shift_unpublished notice per distinct assigned employee (open shifts have
  // no assignee to tell). Best-effort: a notify failure must not undo or report
  // failure for a state transition that already committed.
  if (notify) {
    try {
      const byEmployee = new Map<number, ShiftSlot[]>();
      for (const slot of published) {
        if (slot.employeeId === null) continue;
        const list = byEmployee.get(slot.employeeId) ?? [];
        list.push(slot);
        byEmployee.set(slot.employeeId, list);
      }
      for (const [employeeId, employeeSlots] of Array.from(byEmployee.entries())) {
        const first = employeeSlots[0];
        await notifyEmployee(employeeId, companyId, 'shift_unpublished', {
          day: fmtDay(first.start),
          time: fmtTimeRange(first.start, first.end),
          roleName: first.roleName,
          count: employeeSlots.length,
          message:
            employeeSlots.length === 1
              ? 'A shift was removed from your schedule.'
              : `${employeeSlots.length} shifts were removed from your schedule.`,
        });
      }
    } catch (err: unknown) {
      console.warn(
        '[shifts] unpublish notify failed (ignored):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return published.length;
}
