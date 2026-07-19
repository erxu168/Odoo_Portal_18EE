/**
 * Staff Lifecycle Checklists — pure logic (no DB, no Odoo, no Next.js).
 *
 * Kept pure so it is unit-testable in the Playwright `unit` project. Callers pass
 * `todayISO` (from `berlinToday()` in @/lib/berlin-date) — this module has no clock.
 */
import type { TemplateTaskSeed, Audience, DueState, TaskStatus } from '@/types/staffing';

/** Add N calendar days to a YYYY-MM-DD string; returns YYYY-MM-DD. UTC math avoids DST drift. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function computeDueDate(referenceDateISO: string, offsetDays: number | null): string | null {
  if (offsetDays == null) return null;
  return addDaysISO(referenceDateISO, offsetDays);
}

/** Base tasks first, then add-on tasks; re-sequenced 0..n within each audience section. */
export function mergeTaskSeeds(base: TemplateTaskSeed[], addon: TemplateTaskSeed[]): TemplateTaskSeed[] {
  const out: TemplateTaskSeed[] = [];
  for (const audience of ['business', 'employee'] as Audience[]) {
    const rows = [
      ...base.filter(s => s.audience === audience).sort((a, b) => a.sequence - b.sequence),
      ...addon.filter(s => s.audience === audience).sort((a, b) => a.sequence - b.sequence),
    ];
    rows.forEach((s, i) => out.push({ ...s, sequence: i }));
  }
  return out;
}

export function dueState(params: {
  status: TaskStatus; dueDate: string | null; todayISO: string; dueSoonDays?: number;
}): DueState {
  const { status, dueDate, todayISO, dueSoonDays = 3 } = params;
  if (status === 'done' || status === 'skipped') return 'done';
  if (!dueDate) return 'none';
  if (dueDate < todayISO) return 'overdue';
  if (dueDate === todayISO) return 'due_soon';
  if (addDaysISO(todayISO, dueSoonDays) >= dueDate) return 'due_soon';
  return 'upcoming';
}

/** Highest reminder stage that should have fired: 0 none, 1 lead, 2 due-day, 3 overdue. */
export function reminderStageDue(dueDateISO: string | null, todayISO: string, leadDays = 3): number {
  if (!dueDateISO) return 0;
  if (dueDateISO < todayISO) return 3;
  if (dueDateISO === todayISO) return 2;
  if (addDaysISO(todayISO, leadDays) >= dueDateISO) return 1;
  return 0;
}

/** True when `toLevel` is a strictly higher numeric level than `fromLevel` ('1'|'2'|'3'). */
export function isPromotion(fromLevel: string | null | undefined, toLevel: string | null | undefined): boolean {
  // Number(null) === 0 and Number('') === 0, so reject empties before coercing.
  if (fromLevel == null || toLevel == null || fromLevel === '' || toLevel === '') return false;
  const a = Number(fromLevel), b = Number(toLevel);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b > a;
}
