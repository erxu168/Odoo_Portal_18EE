/** Pure reminder-cadence decisions for shift confirmation (no I/O; unit-tested). */

/**
 * The staff nudge points (in send order) plus the one-time manager escalation.
 * Staff get up to three nudges — the evening before, the morning of, and a final
 * one a few hours before the shift — then, independently, the manager is alerted
 * once a shift is still unconfirmed at its confirm-by cutoff.
 */
export type StaffStage = 'evening' | 'morning' | 'final';
export type ReminderStage = StaffStage | 'overdue_mgr';

/** Absolute epoch-ms send times for the three staff checkpoints of one shift. */
export interface ReminderCheckpoints {
  /** evening-before nudge (e.g. 18:00 Berlin the day before) */
  eveningMs: number;
  /** morning-of nudge (e.g. 09:00 Berlin on the shift day) */
  morningMs: number;
  /** final nudge = shift start − finalLeadHours */
  finalMs: number;
}

/** The confirm-by cutoff (ms epoch): confirmByHours before the shift start. */
export function confirmByMs(startMs: number, confirmByHours: number): number {
  return startMs - confirmByHours * 3600e3;
}

/**
 * Which staff checkpoint (if any) is due right now for one unconfirmed assigned
 * shift. Fires the LATEST checkpoint whose time has passed and has not yet been
 * sent — it never "backfills" earlier missed checkpoints, so a shift published
 * late (or the feature switched on close to a shift) triggers a single, most
 * relevant nudge rather than a burst. Quiet hours suppress staff nudges entirely
 * (they resume on the next cron tick outside the window). Returns null once the
 * shift has started or the staffer has confirmed.
 *
 * Each returned stage is expected to be recorded so it fires at most once.
 */
export function nextStaffCheckpoint(i: {
  startMs: number;
  nowMs: number;
  checkpoints: ReminderCheckpoints;
  sentStages: ReminderStage[];
  confirmed: boolean;
  isQuietNow: boolean;
}): StaffStage | null {
  if (i.confirmed) return null;
  if (i.nowMs >= i.startMs) return null; // shift started — too late to chase
  if (i.isQuietNow) return null; // never nudge staff overnight
  const sent = (s: ReminderStage) => i.sentStages.includes(s);
  // Consider checkpoints by actual send time, latest first — the first one already
  // due is the only one we act on. Sorting (not a fixed stage order) matters for
  // odd configs where `final` lands before `morning` (e.g. an 11:00 shift with a
  // 3h final lead: final 08:00, morning 09:00) — so morning still fires at 09:00.
  const ordered: [StaffStage, number][] = [
    ['evening', i.checkpoints.eveningMs],
    ['morning', i.checkpoints.morningMs],
    ['final', i.checkpoints.finalMs],
  ].sort((a, b) => (b[1] as number) - (a[1] as number)) as [StaffStage, number][];
  for (const [stage, t] of ordered) {
    if (t <= i.nowMs) return sent(stage) ? null : stage;
  }
  return null;
}

/**
 * Whether the one-time manager escalation is due: the shift is still unconfirmed,
 * has not started, we are at/after its confirm-by cutoff, and the manager has not
 * already been alerted. Independent of the staff checkpoints — staff keep getting
 * nudged up to the final checkpoint even after the manager has been told, and the
 * manager alert is not subject to quiet hours (it fires once, with lead time).
 */
export function managerOverdueDue(i: {
  startMs: number;
  nowMs: number;
  confirmByHours: number;
  sentStages: ReminderStage[];
  confirmed: boolean;
}): boolean {
  if (i.confirmed) return false;
  if (i.nowMs >= i.startMs) return false;
  if (i.sentStages.includes('overdue_mgr')) return false;
  return i.nowMs >= confirmByMs(i.startMs, i.confirmByHours);
}

// -- Quiet hours ---------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Is a Berlin wall-clock "HH:MM" inside the quiet window [start, end)? The window
 * may wrap midnight (start > end, e.g. 22:00 → 08:00). start === end → never quiet.
 */
export function inQuietWindow(hhmm: string, start: string, end: string): boolean {
  const t = toMinutes(hhmm);
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}
