import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireCapability, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listDepartments } from '@/lib/odoo-tasks';

export async function GET(req: NextRequest) {
  try {
    const user = requireCapability('tasks.template.manage');
    const allowed = parseCompanyIds(user.allowed_company_ids);

    // Active-company cookie (set by company-context.tsx) wins by default.
    // ?scope=allowed bypasses it for cross-company admin views.
    const scope = req.nextUrl.searchParams.get('scope') || 'active';
    let companies: number[];
    if (scope === 'allowed') {
      companies = allowed;
    } else {
      const activeRaw = cookies().get('kw_company_id')?.value;
      const active = activeRaw ? parseInt(activeRaw, 10) : NaN;
      if (Number.isFinite(active) && allowed.includes(active)) {
        companies = [active];
      } else {
        companies = allowed;
      }
    }

    const departments = await listDepartments(companies);
    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to list departments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
