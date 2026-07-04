/**
 * GET /api/kds/departments?configId=X  (PUBLIC — no-login KDS device)
 * Lists the hr.department records for the register's company, so the KDS
 * settings can scope the task feed to specific department(s).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { companyIdForConfig } from '@/lib/kds/company';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const configId = Number(req.nextUrl.searchParams.get('configId')) || 0;
    const companyId = await companyIdForConfig(configId);
    if (!companyId) return NextResponse.json({ departments: [] });

    const departments = await getOdoo().searchRead(
      'hr.department', [['company_id', '=', companyId]], ['id', 'name'], {},
    );
    return NextResponse.json({ departments: departments.map((d: any) => ({ id: d.id, name: d.name })) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] departments fetch error:', msg);
    return NextResponse.json({ departments: [], error: msg }, { status: 500 });
  }
}
