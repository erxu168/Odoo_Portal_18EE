/**
 * Shift Handover — shared route plumbing.
 * Keeps every /api/shift-handover route consistent: table init, active-company
 * resolution (?company_id → kw_company_id cookie, gated by access), operational
 * date, and a JSON error helper.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { berlinToday } from '@/lib/berlin-date';
import type { PortalUser } from '@/lib/db';
import { initHandoverTables } from './db';
import { authorize, writeCompany, readScope, type Authz } from './access';

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** The single company a request acts on, gated by the user's allowed companies. */
export function resolveCompany(request: Request, user: PortalUser): number | null {
  const url = new URL(request.url);
  const q = parseInt(url.searchParams.get('company_id') || '0', 10);
  const cookie = parseInt(cookies().get('kw_company_id')?.value || '0', 10);
  return writeCompany(user, (q || cookie) || null);
}

export function operationalDate(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('date') || berlinToday();
}

export { initHandoverTables, authorize, readScope, type Authz };
