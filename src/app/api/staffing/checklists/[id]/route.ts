/**
 * GET /api/staffing/checklists/[id] — one instance + its tasks (two sections).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getInstance } from '@/lib/staffing-checklist-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.instances.manage');
    const data = getInstance(Number(params.id));
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, data.instance.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(data);
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET checklist', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
