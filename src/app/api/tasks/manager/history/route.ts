import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getListByDeptAndDate } from '@/lib/odoo-tasks';

export async function GET(req: NextRequest) {
  try {
    requireRole('manager');
    const dept = parseInt(req.nextUrl.searchParams.get('dept') || '', 10);
    const date = req.nextUrl.searchParams.get('date');
    if (Number.isNaN(dept) || !date) {
      return NextResponse.json({ error: 'dept and date query params are required' }, { status: 400 });
    }
    const list = await getListByDeptAndDate(dept, date);
    return NextResponse.json({ list });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
