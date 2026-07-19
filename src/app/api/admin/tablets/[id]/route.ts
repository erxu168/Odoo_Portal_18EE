/**
 * PATCH  /api/admin/tablets/[id]  { enabled: boolean } — turn a tablet's access on/off.
 * DELETE /api/admin/tablets/[id]                        — permanently remove the setup.
 * Session-authed (manager/admin), scoped to the manager's restaurants. Both cut the
 * tablet's live sessions; DELETE also revokes its device token (must be re-set-up).
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getStationDeviceCompany, setStationDeviceDisabled, setStationDeviceName, revokeStationDeviceById, parseCompanyIds, logAudit } from '@/lib/db';
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
    const result: Record<string, unknown> = { ok: true };
    let changed = false;
    // Rename — a friendly per-tablet name so tablets in one restaurant are distinguishable.
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 40) || null;
      setStationDeviceName(a.id, name);
      logAudit({ user_id: a.me.id, user_name: a.me.name, action: 'tablet_renamed', module: 'tablet', detail: `device=${a.id} company=${a.company}` });
      result.name = name;
      changed = true;
    }
    // Turn access on/off.
    if (typeof body.enabled === 'boolean') {
      const enabled = body.enabled;
      setStationDeviceDisabled(a.id, !enabled);
      logAudit({ user_id: a.me.id, user_name: a.me.name, action: enabled ? 'tablet_enabled' : 'tablet_disabled', module: 'tablet', detail: `device=${a.id} company=${a.company}` });
      result.disabled = !enabled;
      changed = true;
    }
    if (!changed) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    return NextResponse.json(result);
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
