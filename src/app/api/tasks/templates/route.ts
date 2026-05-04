import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listTemplates, createTemplate } from '@/lib/odoo-tasks';

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth();
    const includeArchived = req.nextUrl.searchParams.get('include_archived') === '1';
    const companies = parseCompanyIds(user.allowed_company_ids);
    const templates = await listTemplates(companies, includeArchived);
    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to list templates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireRole('manager');
    const body = await req.json();
    if (!body.name || !body.department_id || !body.days_of_week) {
      return NextResponse.json({ error: 'name, department_id, days_of_week required' }, { status: 400 });
    }
    const id = await createTemplate({
      name: body.name,
      department_id: body.department_id,
      days_of_week: body.days_of_week,
      active: body.active !== false,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to create template';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
