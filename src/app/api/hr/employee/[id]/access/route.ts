/**
 * Per-employee PORTAL ACCESS management, scoped for the HR module.
 *
 *   GET    /api/hr/employee/[id]/access   — account + pending-invite status for one employee
 *   POST   /api/hr/employee/[id]/access   — { action: 'invite' | 'resend' | 'revoke' }
 *   PATCH  /api/hr/employee/[id]/access   — modify the linked account's access
 *
 * Auth: manager+ . Managers are scoped to their own restaurant(s) (the employee's
 * Odoo company must be in the manager's allowed_company_ids) and cannot escalate
 * privilege — only admins may change a person's role, touch an admin account, or
 * assign companies outside the manager's own set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import {
  parseCompanyIds,
  getAccountByEmployeeId,
  getUserById,
  updateUser,
  resetPassword,
  getActiveInviteByEmployeeId,
  revokeInvitesForEmployee,
  type PortalUser,
} from '@/lib/db';
import { createStaffInvite, inviteEmailNotice } from '@/lib/hr/invites';

interface OdooEmp {
  id: number;
  name?: string;
  work_email?: string | false;
  private_email?: string | false;
  company_id?: [number, string] | false;
  department_id?: [number, string] | false;
}

async function loadEmployee(employeeId: number): Promise<OdooEmp | null> {
  const rows = (await getOdoo().searchRead(
    'hr.employee',
    [['id', '=', employeeId]],
    ['name', 'work_email', 'private_email', 'company_id', 'department_id'],
    { limit: 1 },
  )) as OdooEmp[];
  return rows?.[0] || null;
}

function employeeCompanyId(emp: OdooEmp): number | null {
  return Array.isArray(emp.company_id) ? emp.company_id[0] : null;
}

/** Manager scope: the employee must belong to one of the manager's companies. */
function inScope(user: PortalUser, companyId: number | null): boolean {
  if (user.role === 'admin') return true;
  return companyId != null && parseCompanyIds(user.allowed_company_ids).includes(companyId);
}

function accountView(a: PortalUser) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    role: a.role,
    active: a.active,
    allowed_company_ids: parseCompanyIds(a.allowed_company_ids),
    module_access: a.module_access,
    has_pin: a.has_pin ? 1 : 0,
    last_login: a.last_login,
  };
}

async function resolveScoped(idParam: string, user: PortalUser) {
  const employeeId = parseInt(idParam, 10);
  if (!employeeId || Number.isNaN(employeeId)) {
    return { error: NextResponse.json({ error: 'Invalid employee id' }, { status: 400 }) } as const;
  }
  const emp = await loadEmployee(employeeId);
  if (!emp) {
    return { error: NextResponse.json({ error: 'Employee not found' }, { status: 404 }) } as const;
  }
  if (!inScope(user, employeeCompanyId(emp))) {
    return { error: NextResponse.json({ error: 'You can only manage staff in your own restaurant.' }, { status: 403 }) } as const;
  }
  return { employeeId, emp } as const;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const r = await resolveScoped(params.id, user);
    if ('error' in r) return r.error;

    const account = getAccountByEmployeeId(r.employeeId);
    const invite = account ? null : getActiveInviteByEmployeeId(r.employeeId);
    const status = account ? 'active' : invite ? 'invited' : 'none';

    return NextResponse.json({
      status,
      account: account ? accountView(account) : null,
      invite: invite ? { expires_at: invite.expires_at, created_at: invite.created_at, created_by: invite.created_by } : null,
      viewer: { role: user.role, is_admin: user.role === 'admin', own_user_id: user.id },
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/hr/employee/[id]/access error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load access' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const r = await resolveScoped(params.id, user);
    if ('error' in r) return r.error;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const actor = { id: user.id, name: user.name || user.email };

    if (action === 'invite' || action === 'resend') {
      const existing = getAccountByEmployeeId(r.employeeId);
      if (existing) {
        return NextResponse.json({
          error: existing.active
            ? 'This employee already has a portal account.'
            : 'This employee has a deactivated account — reactivate it instead of sending a new link.',
        }, { status: 409 });
      }
      const result = await createStaffInvite(r.employeeId, actor, { sendEmail: true });
      if (!result.ok) {
        return NextResponse.json({ error: result.body.error }, { status: result.status });
      }
      const status = result.body.email_status || 'skipped';
      return NextResponse.json({
        message: inviteEmailNotice(status, result.body.name || 'This staff member', result.body.email ?? null),
        link: result.body.link,
        share_text: result.body.share_text,
        email_status: status,
      });
    }

    if (action === 'revoke') {
      revokeInvitesForEmployee(r.employeeId);
      return NextResponse.json({ message: 'Invite link cancelled. Send a new one when ready.' });
    }

    return NextResponse.json({ error: 'Invalid action. Use invite, resend, or revoke.' }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/employee/[id]/access error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update link' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const isAdmin = user.role === 'admin';
    const r = await resolveScoped(params.id, user);
    if ('error' in r) return r.error;

    const account = getAccountByEmployeeId(r.employeeId);
    if (!account) {
      return NextResponse.json({ error: 'This employee has no portal account yet.' }, { status: 404 });
    }
    // A non-admin may never modify an admin's account.
    if (account.role === 'admin' && !isAdmin) {
      return NextResponse.json({ error: 'Only an admin can change an admin account.' }, { status: 403 });
    }

    const body = await req.json();
    const updates: { role?: string; active?: number; allowed_company_ids?: number[]; module_access?: string[] | null } = {};

    // Role — admin only (prevents managers from escalating anyone to admin/manager).
    if (body.role !== undefined) {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Only an admin can change a person’s role.' }, { status: 403 });
      }
      if (!['staff', 'manager', 'admin'].includes(body.role)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
      }
      updates.role = body.role;
    }

    // Company access — managers may only flip companies within their own set,
    // and must not remove/keep-changed any company outside it.
    if (body.allowed_company_ids !== undefined) {
      if (!Array.isArray(body.allowed_company_ids) || !body.allowed_company_ids.every((n: unknown) => typeof n === 'number')) {
        return NextResponse.json({ error: 'allowed_company_ids must be an array of numbers' }, { status: 400 });
      }
      const next: number[] = body.allowed_company_ids;
      if (!isAdmin) {
        const allowed = parseCompanyIds(user.allowed_company_ids);
        const prev = parseCompanyIds(account.allowed_company_ids);
        // Every company that is being ADDED or REMOVED must be one the manager owns.
        const changed = [...prev.filter((c) => !next.includes(c)), ...next.filter((c) => !prev.includes(c))];
        if (changed.some((c) => !allowed.includes(c))) {
          return NextResponse.json({ error: 'You can only assign your own restaurant(s).' }, { status: 403 });
        }
      }
      updates.allowed_company_ids = next;
    }

    // Module access — null resets to role default, else an allowlist of ids.
    if (body.module_access !== undefined) {
      if (body.module_access === null || (Array.isArray(body.module_access) && body.module_access.every((m: unknown) => typeof m === 'string'))) {
        updates.module_access = body.module_access;
      } else {
        return NextResponse.json({ error: 'module_access must be null or an array of strings' }, { status: 400 });
      }
    }

    // Active — cannot deactivate your own account (avoid self-lockout).
    if (body.active !== undefined) {
      if (!body.active && account.id === user.id) {
        return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
      }
      updates.active = body.active ? 1 : 0;
    }

    // (PIN setting removed — the single staff PIN is the clock-in PIN, set only via the
    // staff's own time-clock flow, e.g. email-code self-serve + forgot-PIN reset.)

    if (Object.keys(updates).length > 0) updateUser(account.id, updates);
    if (body.new_password) resetPassword(account.id, String(body.new_password));

    const updated = getUserById(account.id);
    return NextResponse.json({ account: updated ? accountView(updated) : null });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/hr/employee/[id]/access error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update access' }, { status: 500 });
  }
}
