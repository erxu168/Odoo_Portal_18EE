/**
 * DELETE /api/shifts/templates/[id]?company_id= — manager removes a template.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../../_manager';
import { deleteShiftTemplate } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }
    const ok = deleteShiftTemplate(id, auth.companyId);
    return NextResponse.json({ ok });
  } catch (err: unknown) {
    return serverError('DELETE templates/[id]', err);
  }
}
