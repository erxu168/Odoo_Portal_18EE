export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { berlinToday } from '@/lib/berlin-date';
import { listClearedStorage } from '@/lib/shift-handover/db';
import { moduleForbidden } from '@/lib/module-access';

const WINDOW_DAYS = 7;

/** Berlin-local 'YYYY-MM-DD' for an ISO instant. */
function berlinDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

// GET — items cleared from "In storage now" over the last 7 Berlin days, for the
// history screen. Read-only; nothing is deleted, so it can always look back a week.
export async function GET(request: Request) {
  const denied = moduleForbidden('shift-handover');
  if (denied) return denied;

  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  // The window is 7 whole Berlin calendar days: today and the 6 days before it.
  const start = new Date(`${berlinToday()}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  const cutoffDay = start.toISOString().slice(0, 10);
  // Fetch a slightly generous UTC window, then keep rows whose BERLIN day is in range.
  const since = new Date(Date.now() - (WINDOW_DAYS + 2) * 86400_000).toISOString();
  const rows = listClearedStorage(companyId, since).filter((s) => s.used_at && berlinDayOf(s.used_at) >= cutoffDay);

  const tally = { used_up: 0, moved_out: 0, discarded: 0 };
  const items = rows.map((s) => {
    if (s.cleared_reason && s.cleared_reason in tally) tally[s.cleared_reason as keyof typeof tally] += 1;
    return {
      id: s.id,
      name: s.name,
      amount: s.amount,
      unit: s.unit,
      location_text: s.location_text,
      prepared_on: s.prepared_on,
      reason: s.cleared_reason,
      cleared_by_name: s.used_by_name,
      cleared_at: s.used_at,
    };
  });

  return NextResponse.json({ window_days: WINDOW_DAYS, tally, items });
}
