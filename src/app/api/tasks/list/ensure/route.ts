import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { ensureListForDeptDate } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest) {
  try {
    requireRole('manager');
    const body = await req.json();
    const departmentId = parseInt(body.department_id, 10);
    const date = String(body.date || '');
    if (!Number.isFinite(departmentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'department_id and date (YYYY-MM-DD) required' }, { status: 400 });
    }
    const id = await ensureListForDeptDate(departmentId, date);
    return NextResponse.json({ ok: true, list_id: id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to ensure list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
