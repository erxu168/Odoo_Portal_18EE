/**
 * Staff portal invite logic — the "push" provisioning model.
 *
 * A manager (or Odoo, on hire) creates an invite bound to one specific
 * hr.employee. The employee opens the link, sets a password, and their
 * portal account is created already linked to that employee — so the account
 * can never be unlinked or attached to the wrong person.
 *
 * Callers:
 *   - /api/admin/staff-access            (cookie-authed, admin: invite / resend / invite_all)
 *   - /api/internal/hr/staff-invite      (bearer token, Odoo auto-invite on hire)
 *   - /api/invite/[token]/accept         (public, the employee accepts)
 */

import crypto from 'crypto';
import { getOdoo } from '@/lib/odoo';
import {
  createInvite,
  getInviteByTokenHash,
  revokeInvitesForEmployee,
  markInviteAccepted,
  createUser,
  getUserByEmail,
  getUserByEmployeeId,
  createSession,
  logAudit,
} from '@/lib/db';
import { sendStaffInviteEmail } from '@/lib/email';

export const INVITE_TTL_DAYS = 14;
const PORTAL_URL = (process.env.PORTAL_URL || 'http://89.167.124.0:3000').replace(/\/$/, '');

export interface Actor {
  id: number;
  name: string;
}

export interface EmployeeLite {
  id: number;
  name: string;
  email: string | null;
  companyId?: number;
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function inviteLink(token: string): string {
  return `${PORTAL_URL}/invite/${token}`;
}

export function shareMessage(name: string, link: string): string {
  return `Hi ${name}, welcome to Krawings! Set up your staff portal account here: ${link} (link expires in ${INVITE_TTL_DAYS} days).`;
}

export type InviteEmailStatus = 'sent' | 'no_address' | 'failed' | 'skipped';

/**
 * Manager-facing sentence describing what happened with the invite email, so
 * whoever pressed "Invite" always knows whether they still have to hand the
 * link over themselves — either because the employee has no address on file or
 * because the send failed.
 */
export function inviteEmailNotice(status: InviteEmailStatus, name: string, email: string | null): string {
  switch (status) {
    case 'sent':
      return `Invite emailed to ${name}${email ? ` at ${email}` : ''}.`;
    case 'failed':
      return `Heads up: the invite email to ${email || 'their address'} could not be sent. Copy the link below and share it with ${name} directly, then check the email settings.`;
    case 'no_address':
      return `${name} has no email address on file, so no invite email was sent. Copy the link below and share it with them directly.`;
    case 'skipped':
    default:
      return `Invite link created for ${name}. Copy it below to share.`;
  }
}

function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/\d/.test(pw)) return 'Password must contain at least one number.';
  return null;
}

/**
 * Store a fresh invite for already-known employee data (no Odoo fetch).
 * Revokes any prior pending invite so only one is ever live per employee.
 * Returns the raw token's link + (if requested + possible) whether email sent.
 */
export async function storeInviteForEmployee(
  emp: EmployeeLite,
  actor: Actor,
  sendEmail: boolean,
): Promise<{ inviteId: number; link: string; emailSent: boolean; emailStatus: InviteEmailStatus }> {
  revokeInvitesForEmployee(emp.id);

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const inviteId = createInvite({
    employee_id: emp.id,
    name: emp.name,
    email: emp.email,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: actor.name,
  });

  const link = inviteLink(token);
  let emailSent = false;
  // Default reflects why no mail goes out: not requested → skipped, requested
  // but the employee has no address → no_address. A real attempt overwrites it.
  let emailStatus: InviteEmailStatus = sendEmail ? 'no_address' : 'skipped';
  if (sendEmail && emp.email) {
    try {
      await sendStaffInviteEmail(emp.email, emp.name, link, emp.companyId);
      emailSent = true;
      emailStatus = 'sent';
    } catch (err: unknown) {
      console.error('[staff-invite] welcome email failed:', err);
      emailStatus = 'failed';
    }
  }

  logAudit({
    user_id: actor.id || null,
    user_name: actor.name,
    action: 'create_staff_invite',
    module: 'staff_access',
    target_type: 'hr.employee',
    target_id: emp.id,
    detail: `Invite for ${emp.name} (${emp.email || 'no email'}) — email=${emailStatus}`,
  });

  return { inviteId, link, emailSent, emailStatus };
}

/**
 * Fire-and-forget bulk email send (used by invite_all so the HTTP request
 * returns immediately). Sequential to stay gentle on the SMTP server.
 */
export async function sendInviteEmailsInBackground(
  items: { email: string; name: string; link: string; companyId?: number }[],
): Promise<void> {
  for (const item of items) {
    try {
      await sendStaffInviteEmail(item.email, item.name, item.link, item.companyId);
    } catch (err: unknown) {
      console.error(`[staff-invite] bulk email failed for ${item.email}:`, err);
    }
  }
}

export interface CreateInviteResult {
  ok: boolean;
  status: 200 | 400 | 404 | 409 | 500;
  body: {
    success?: boolean;
    error?: string;
    invite_id?: number;
    employee_id?: number;
    name?: string;
    email?: string | null;
    email_sent?: boolean;
    email_status?: InviteEmailStatus;
    link?: string;
    share_text?: string;
    portal_user_id?: number;
  };
}

/**
 * Create (or refresh) an invite for one Odoo employee id.
 * Reads name/email straight from Odoo so the invite is always accurate.
 */
export async function createStaffInvite(
  employeeId: number,
  actor: Actor,
  opts: { sendEmail?: boolean } = {},
): Promise<CreateInviteResult> {
  const sendEmail = opts.sendEmail !== false;

  if (!employeeId || !Number.isFinite(employeeId)) {
    return { ok: false, status: 400, body: { error: 'employee_id is required' } };
  }

  const existingUser = getUserByEmployeeId(employeeId);
  if (existingUser) {
    return {
      ok: false,
      status: 409,
      body: { error: 'This employee already has a portal account', portal_user_id: existingUser.id },
    };
  }

  const odoo = getOdoo();
  const employees = await odoo.searchRead(
    'hr.employee',
    [['id', '=', employeeId]],
    ['name', 'work_email', 'private_email', 'mobile_phone', 'company_id'],
    { limit: 1 },
  );
  if (!employees || employees.length === 0) {
    return { ok: false, status: 404, body: { error: 'Employee not found in Odoo' } };
  }

  const emp = employees[0];
  const name: string = emp.name || 'Team member';
  const email: string | null = emp.work_email || emp.private_email || null;
  const companyId: number | undefined = Array.isArray(emp.company_id) ? (emp.company_id[0] as number) : undefined;

  const { inviteId, link, emailSent, emailStatus } = await storeInviteForEmployee({ id: employeeId, name, email, companyId }, actor, sendEmail);

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      invite_id: inviteId,
      employee_id: employeeId,
      name,
      email,
      email_sent: emailSent,
      email_status: emailStatus,
      link,
      share_text: shareMessage(name, link),
    },
  };
}

export interface AcceptResult {
  ok: boolean;
  status: 200 | 400 | 404 | 409 | 410;
  body: { success?: boolean; error?: string; name?: string; user_id?: number };
  sessionToken?: string;
}

/**
 * The employee's Odoo company as a one-element array (empty if the employee has
 * no company or Odoo is unreachable). Used to give a new portal account a
 * company — without one the header reads "No companies assigned" and every
 * company-scoped page (open shifts, etc.) fails with "company_id is required".
 */
async function employeeCompanyIds(employeeId: number): Promise<number[]> {
  try {
    const emps = await getOdoo().searchRead('hr.employee', [['id', '=', employeeId]], ['company_id'], { limit: 1 });
    const cid = emps?.[0]?.company_id;
    const companyId = Array.isArray(cid) ? (cid[0] as number) : typeof cid === 'number' ? cid : null;
    return companyId ? [companyId] : [];
  } catch (err: unknown) {
    console.error('[staff-invite] could not resolve employee company at accept:', err);
    return [];
  }
}

/**
 * Accept an invite: create the linked portal account + a logged-in session.
 */
export async function acceptStaffInvite(token: string, email: string, password: string): Promise<AcceptResult> {
  const invite = getInviteByTokenHash(hashInviteToken(token || ''));

  if (!invite || invite.status !== 'pending') {
    return { ok: false, status: 404, body: { error: 'This invite is no longer valid. Ask your manager to send a new one.' } };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, body: { error: 'This invite has expired. Ask your manager to send a new one.' } };
  }

  // Someone already turned this employee into an account — don't double-create.
  if (getUserByEmployeeId(invite.employee_id)) {
    markInviteAccepted(invite.id);
    return { ok: false, status: 409, body: { error: 'An account already exists for you. Please log in instead.' } };
  }

  const cleanEmail = (email || '').toLowerCase().trim();
  if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { ok: false, status: 400, body: { error: 'Please enter a valid email address.' } };
  }
  const pwError = validatePassword(password);
  if (pwError) {
    return { ok: false, status: 400, body: { error: pwError } };
  }
  if (getUserByEmail(cleanEmail)) {
    return { ok: false, status: 409, body: { error: 'That email is already in use. Please log in or use a different email.' } };
  }

  const userId = createUser(invite.name, cleanEmail, password, 'staff', {
    employee_id: invite.employee_id,
    status: 'active',
    allowed_company_ids: await employeeCompanyIds(invite.employee_id),
  });
  markInviteAccepted(invite.id);
  const sessionToken = createSession(userId);

  logAudit({
    user_id: userId,
    user_name: invite.name,
    action: 'accept_staff_invite',
    module: 'staff_access',
    target_type: 'hr.employee',
    target_id: invite.employee_id,
    detail: `Accepted invite; account ${userId} (${cleanEmail})`,
  });

  return { ok: true, status: 200, body: { success: true, user_id: userId, name: invite.name }, sessionToken };
}
