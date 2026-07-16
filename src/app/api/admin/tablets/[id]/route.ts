/**
 * PATCH  /api/admin/tablets/[id]  { enabled: boolean } — turn a tablet's access on/off.
 * DELETE /api/admin/tablets/[id]                        — permanently remove the setup.
 * Session-authed (manager/admin), scoped to the manager's restaurants. Both cut the
 * tablet's live sessions; DELETE also revokes its device token (must be re-set-up).
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getStationDeviceCompany, setStationDeviceDisabled, revokeStationDeviceById, parseCompanyIds, logAudit } from '@/lib/db';
import { isSameOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

function authorize(request: Request, idStr: string) {
  if (!isSameOrigin(request)) return { error: NextResponse.json({ error: 'Request blocked.' }, { status: 403 }) };
  const me = requireRole('manager'); // throws AuthError if not a manager/admin session
  const id = /^\d+$/.test(idStr) ? Number(idStr) : NaN;
  if (!Number.isInteger(id) || id <= 0) return { error: NextResponse.json({ error: 'Bad id' }, { status: 400 }) };
  const company = getStationDeviceCompany(id);
  if (company == null) return { error: NextResponse.json({ error: 'Tablet not found' }, { status: 404 }) };
  if (me.role !== 'admin' && !parseCompanyIds(me.allowed_company_ids).includes(company)) {
    return { error: NextResponse.json({ error: 'You can’t manage this tablet.' }, { status: 403 }) };
  }
  return { me, id, company };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const a = authorize(request, params.id);
    if (a.error) return a.error;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 });
    }
    const enabled = body.enabled;
    setStationDeviceDisabled(a.id, !enabled);
    logAudit({ user_id: a.me.id, user_name: a.me.name, action: enabled ? 'tablet_enabled' : 'tablet_disabled', module: 'tablet', detail: `device=${a.id} company=${a.company}` });
    return NextResponse.json({ ok: true, disabled: !enabled });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/admin/tablets/[id] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const a = authorize(request, params.id);
    if (a.error) return a.error;
    revokeStationDeviceById(a.id);
    logAudit({ user_id: a.me.id, user_name: a.me.name, action: 'tablet_removed', module: 'tablet', detail: `device=${a.id} company=${a.company}` });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('DELETE /api/admin/tablets/[id] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
