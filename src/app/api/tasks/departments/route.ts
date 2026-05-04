import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listDepartments } from '@/lib/odoo-tasks';

export async function GET() {
  try {
    const user = requireRole('manager');
    const companies = parseCompanyIds(user.allowed_company_ids);
    const departments = await listDepartments(companies);
    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to list departments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
