/** Pure reminder-stage decision for shift confirmation (no I/O; unit-tested). */
export type ReminderStage = 'first' | 'reminder' | 'overdue_mgr';

/** Only begin 'first' nudges once a shift is within this window — avoids a burst when first enabled. */
export const FIRST_LEAD_MS = 7 * 24 * 3600e3;
/** 'reminder' fires once we are within this long of the confirm-by cutoff. */
export const REMINDER_LEAD_MS = 6 * 3600e3;

/** The confirm-by cutoff (ms epoch): confirmByHours before the shift start. */
export function confirmByMs(startMs: number, confirmByHours: number): number {
  return startMs - confirmByHours * 3600e3;
}

/**
 * Which reminder (if any) is due right now for one unconfirmed assigned shift.
 * - confirmed or already-started shift → nothing.
 * - before cutoff: `first` (once the shift is within FIRST_LEAD_MS), then
 *   `reminder` (once within REMINDER_LEAD_MS of the cutoff).
 * - at/after cutoff: `overdue_mgr` (alert the manager, once).
 * Each stage is expected to be recorded so it fires at most once per shift.
 */
export function nextReminderStage(i: {
  startMs: number;
  nowMs: number;
  confirmByHours: number;
  sentStages: ReminderStage[];
  confirmed: boolean;
}): ReminderStage | null {
  if (i.confirmed) return null;
  if (i.nowMs >= i.startMs) return null; // shift started — too late to chase
  const sent = (s: ReminderStage) => i.sentStages.includes(s);
  const cutoff = confirmByMs(i.startMs, i.confirmByHours);
  if (i.nowMs >= cutoff) return sent('overdue_mgr') ? null : 'overdue_mgr';
  if (!sent('first')) return i.startMs - i.nowMs <= FIRST_LEAD_MS ? 'first' : null;
  if (!sent('reminder') && cutoff - i.nowMs <= REMINDER_LEAD_MS) return 'reminder';
  return null;
}
