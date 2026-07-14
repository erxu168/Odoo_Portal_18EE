/**
 * station-roster.ts
 * "Who's on today" for the shared-tablet kitchen station home.
 *
 * Read-only. Reuses the shifts access layer (planning.slot) — no new Odoo model.
 * Returns only names / roles / Berlin start-end times (no pay, caps or skills),
 * so it is safe to expose at staff level on a shared device.
 */

import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { currentWeekKey, berlinParts } from '@/lib/shifts-time';
import { berlinToday } from '@/lib/berlin-date';

export interface RosterEntry {
  name: string;
  role: string;
  start: string; // Berlin "HH:MM"
  end: string;   // Berlin "HH:MM"
}

/** Published, assigned shifts that START today (Berlin), sorted by start time. */
export async function getTodayRoster(companyId: number): Promise<RosterEntry[]> {
  const today = berlinToday();
  const slots = await fetchWeekSlots(companyId, currentWeekKey());
  return slots
    .filter(s => s.state === 'published' && s.resourceId != null)
    .map(s => ({ slot: s, sp: berlinParts(s.start) }))
    .filter(x => x.sp.date === today)
    .map(x => ({
      name: x.slot.employeeName || 'Unassigned',
      role: x.slot.roleName || '',
      start: x.sp.hhmm,
      end: berlinParts(x.slot.end).hhmm,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
