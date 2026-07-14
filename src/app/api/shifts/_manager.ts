/**
 * Shifts module — shared helpers for the manager API routes.
 * Colocated (non-route) file: manager auth + company validation, week-key
 * parsing, rounding, input validation and notification slot summaries.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { currentWeekKey, fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot, SlotSnapshot } from '@/types/shifts';

export type ManagerAuth =
  | { ok: true; user: PortalUser; companyId: number }
  | { ok: false; res: NextResponse };

/**
 * Manager-route gate: the session user must be manager or higher, and the
 * company_id (query param or body field) must be one of the user's allowed
 * companies. Admins may act on any company.
 */
export function requireManagerCompany(companyIdRaw: unknown): ManagerAuth {
  const user = getCurrentUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!hasRole(user, 'manager')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const companyId =
    typeof companyIdRaw === 'number' ? companyIdRaw : parseInt(String(companyIdRaw ?? ''), 10);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return { ok: false, res: NextResponse.json({ error: 'company_id is required' }, { status: 400 }) };
  }
  if (user.role !== 'admin' && !parseCompanyIds(user.allowed_company_ids).includes(companyId)) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'You do not have access to this company' }, { status: 403 }),
    };
  }
  return { ok: true, user, companyId };
}

/** Parse a ?week= / body.week value. Missing → current week; invalid → null. */
export function resolveWeekKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return currentWeekKey();
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-W(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  return `${m[1]}-W${String(week).padStart(2, '0')}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Notification slot summary {day, time, roleName}; falls back to the snapshot. */
export function slotSummaryPayload(
  slot: ShiftSlot | null,
  snap?: SlotSnapshot,
): { day: string; time: string; roleName: string } {
  const start = slot?.start || snap?.start || '';
  const end = slot?.end || snap?.end || '';
  return {
    day: start ? fmtDay(start) : '',
    time: start && end ? fmtTimeRange(start, end) : '',
    roleName: slot?.roleName || '',
  };
}

/** Uniform 500 handler: log with the [shifts] prefix, return a friendly error. */
export function serverError(scope: string, err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[shifts] ${scope} failed: ${msg}`);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{1,2}:\d{2}$/;

export function isValidDateStr(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v);
}

/** Validate and normalize "H:MM"/"HH:MM" → "HH:MM"; null when invalid. */
export function normalizeHHMM(v: unknown): string | null {
  if (typeof v !== 'string' || !HHMM_RE.test(v)) return null;
  const [h, m] = v.split(':');
  const hh = Number(h);
  const mm = Number(m);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${m}`;
}
