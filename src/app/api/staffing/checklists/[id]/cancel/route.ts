/**
 * POST /api/staffing/checklists/[id]/cancel — cancel an open checklist (manager).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getInstance, cancelInstance } from '@/lib/staffing-checklist-db';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.instances.manage');
    const data = getInstance(Number(params.id));
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, data.instance.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    cancelInstance(data.instance.id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST cancel', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
