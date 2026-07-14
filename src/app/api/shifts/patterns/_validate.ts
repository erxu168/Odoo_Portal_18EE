/**
 * Shared validation for pattern lines (colocated, non-route).
 * Parses/normalizes the `lines[]` body used by POST /patterns and PUT /patterns/[id].
 */
import { normalizeHHMM } from '../_manager';
import type { ShiftPatternLine } from '@/types/shifts';

export type ParseLinesResult =
  | { ok: true; lines: ShiftPatternLine[] }
  | { ok: false; error: string };

/** Validate and normalize a raw lines array into ShiftPatternLine[]. */
export function parsePatternLines(raw: unknown): ParseLinesResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Add at least one shift to the pattern' };
  }
  if (raw.length > 100) {
    return { ok: false, error: 'Too many shifts in one pattern (max 100)' };
  }
  const lines: ShiftPatternLine[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const weekday = Number(o.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return { ok: false, error: 'Each shift needs a weekday (Mon–Sun)' };
    }
    const startHHMM = normalizeHHMM(o.start ?? o.startHHMM);
    const endHHMM = normalizeHHMM(o.end ?? o.endHHMM);
    if (!startHHMM || !endHHMM) {
      return { ok: false, error: 'Each shift needs valid start and end times' };
    }
    if (startHHMM === endHHMM) {
      return { ok: false, error: 'A shift must be longer than zero hours' };
    }
    const roleRaw = o.role_id ?? o.roleId;
    const roleId = typeof roleRaw === 'number' && roleRaw > 0 ? roleRaw : null;
    const deptRaw = o.department_id ?? o.departmentId;
    const departmentId = typeof deptRaw === 'number' && deptRaw > 0 ? deptRaw : null;
    const hcRaw = o.headcount === undefined ? 1 : Number(o.headcount);
    if (!Number.isInteger(hcRaw) || hcRaw < 1 || hcRaw > 20) {
      return { ok: false, error: 'Headcount must be between 1 and 20' };
    }
    const skillRaw = o.min_skill ?? o.minSkill;
    const minSkill = skillRaw === '2' || skillRaw === '3' ? skillRaw : null;
    lines.push({ weekday, startHHMM, endHHMM, roleId, departmentId, headcount: hcRaw, minSkill });
  }
  return { ok: true, lines };
}
