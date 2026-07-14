import { NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getDashboard } from '@/lib/odoo-tasks';

export async function GET() {
  try {
    const user = requireCapability('tasks.manager.view');
    const companies = parseCompanyIds(user.allowed_company_ids);
    const dashboard = await getDashboard(companies);
    return NextResponse.json(dashboard);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load dashboard';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
