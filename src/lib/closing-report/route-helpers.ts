// Closing Report — shared route plumbing (mirrors the Shift Handover module).
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isCanonicalDay } from '@/lib/berlin-date';
import type { PortalUser } from '@/lib/db';
import { initClosingTables } from './db';
import { closingOperationalDate } from './night';
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

/** The night a request is about: an explicit ?date, else the current night. */
export function requestedNight(request: Request): string {
  const raw = new URL(request.url).searchParams.get('date');
  return raw && isCanonicalDay(raw) ? raw : closingOperationalDate();
}

export function requestedDepartment(request: Request): number | null {
  const raw = parseInt(new URL(request.url).searchParams.get('department_id') || '0', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export { initClosingTables, authorize, readScope, type Authz };
