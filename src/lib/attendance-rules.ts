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
export const DEFAULT_ATTENDANCE_RULES = `TIME ATTENDANCE RULES

Please help us maintain accurate attendance records by following these rules:

• Clock in before you begin any work.
• Clock out immediately after your shift has ended.
• Record every unpaid break before leaving your work area.
• Personal breaks, including smoking breaks, personal phone calls, and other non-work-related time away from your workstation, are unpaid and must be recorded as unpaid breaks unless authorized by management.
• Never clock in, clock out, or record breaks for another employee.
• If you forget to clock in, clock out, or record a break, notify your manager as soon as possible and no later than the end of your shift.
• Review your recorded working time before leaving each day and report any errors immediately.
• Falsifying attendance records, including buddy punching or intentionally failing to record unpaid breaks, may result in disciplinary action.
• By clocking in, you confirm that your attendance record is accurate and that you agree to comply with these rules.

Thank you for helping us keep our attendance records accurate and fair for everyone.`;

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
