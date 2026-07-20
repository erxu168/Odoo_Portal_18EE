/**
 * Shifts module — attendance-rules acknowledgement (Phase 2).
 *
 * Pure helpers for the "read the rules, tap I Understand before clocking in" gate:
 * the default policy text, a content hash (to detect edits), and the per-cadence
 * decision of whether a given person still needs to acknowledge. No I/O — unit-testable.
 */
import { createHash } from 'crypto';

/** How often staff must re-acknowledge the rules. */
export type RulesCadence = 'every_clockin' | 'daily' | 'on_change';
export const RULES_CADENCES: RulesCadence[] = ['every_clockin', 'daily', 'on_change'];

/** Default policy wording (manager-editable). Shown when no custom text is set. */
export const DEFAULT_ATTENDANCE_RULES = `Attendance Rules

• Please arrive on time for every scheduled shift.
• Work only during your scheduled working hours.
• Overtime must be approved by management before it is worked.
• All breaks, including smoking breaks, must be recorded in the system.
• Never ask another employee to clock in or out on your behalf.
• Do not clock in until you are ready to begin work.
• Do not continue working after your scheduled shift without approval.
• Follow all food safety and workplace safety procedures.
• Report any attendance issues immediately to your manager.
• Repeated lateness, missing clock events, or policy violations may result in disciplinary action.
• Accurate attendance records are a condition of employment.`;

/** Stable short hash of the rules text (whitespace-normalised) — used for "changed?" detection. */
export function rulesHash(text: string): string {
  const normalised = (text || '').replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(normalised).digest('hex').slice(0, 16);
}

/**
 * Does this person still need to acknowledge before clocking in?
 *   every_clockin — always (a fresh acknowledgement each shift start).
 *   daily         — not yet acknowledged today.
 *   on_change     — not yet acknowledged the CURRENT rules text.
 */
export function needsAcknowledgement(
  cadence: RulesCadence,
  state: { ackedToday: boolean; ackedCurrentHash: boolean },
): boolean {
  switch (cadence) {
    case 'every_clockin':
      return true;
    case 'daily':
      return !state.ackedToday;
    case 'on_change':
      return !state.ackedCurrentHash;
    default:
      return true;
  }
}
