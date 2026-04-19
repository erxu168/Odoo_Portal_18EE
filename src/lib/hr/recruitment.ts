/**
 * Shared server-side logic for the recruitment → portal handoff.
 *
 * Two callers today:
 *   - /api/hr/recruitment/create-access          (cookie-authed, manager-only)
 *   - /api/internal/hr/recruitment/create-access (bearer token, for Odoo)
 *
 * Keeping the logic here means both routes behave identically and audit
 * events look the same; only the auth layer differs.
 */

import { OdooClient } from '@/lib/odoo';
import {
  createUser,
  getUserByApplicantId,
  getUserByEmail,
  logAudit,
  updateUser,
} from '@/lib/db';
import { sendCandidateWelcomeEmail } from '@/lib/email';

export interface Actor {
  id: number;
  name: string;
}

export type CreateAccessResponse =
  | {
      ok: true;
      status: 200;
      body: {
        success: true;
        portal_user_id: number;
        email_sent: boolean;
        candidate_name: string;
        candidate_email: string;
        temp_password?: string;
        warning?: string;
      };
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 500;
      body: { error: string; portal_user_id?: number };
    };

export type PromoteResponse =
  | {
      ok: true;
      status: 200;
      body: { success: true; portal_user_id: number };
    }
  | {
      ok: false;
      status: 400 | 404 | 500;
      body: { error: string };
    };

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

export async function createApplicantPortalAccess(
  applicantId: number,
  actor: Actor,
): Promise<CreateAccessResponse> {
  if (!applicantId || !Number.isFinite(applicantId)) {
    return { ok: false, status: 400, body: { error: 'applicant_id is required' } };
  }

  const existing = getUserByApplicantId(applicantId);
  if (existing) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'This applicant already has portal access',
        portal_user_id: existing.id,
      },
    };
  }

  const odoo = new OdooClient();
  await odoo.authenticate();

  const applicants = await odoo.searchRead(
    'hr.applicant',
    [['id', '=', applicantId]],
    ['partner_name', 'email_from', 'partner_id', 'job_id', 'stage_id', 'department_id'],
    { limit: 1 },
  );

  if (!applicants || applicants.length === 0) {
    return { ok: false, status: 404, body: { error: 'Applicant not found in Odoo' } };
  }

  const applicant = applicants[0];
  const name = applicant.partner_name || 'Candidate';
  const email = applicant.email_from;
  const jobName = applicant.job_id ? applicant.job_id[1] : 'Open Position';

  if (!email) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Applicant has no email address in Odoo' },
    };
  }

  const emailUser = getUserByEmail(email);
  if (emailUser) {
    return {
      ok: false,
      status: 409,
      body: {
        error: `Email ${email} is already registered to another portal user (${emailUser.name})`,
      },
    };
  }

  const tempPassword = generateTempPassword();
  const portalUserId = createUser(name, email, tempPassword, 'staff', {
    applicant_id: applicantId,
    must_change_password: true,
    status: 'active',
  });

  try {
    await sendCandidateWelcomeEmail(email, name, tempPassword, jobName);
  } catch (emailErr: unknown) {
    console.error('Failed to send welcome email:', emailErr);
    logAudit({
      user_id: actor.id,
      user_name: actor.name,
      action: 'create_candidate_access',
      module: 'recruitment',
      target_type: 'hr.applicant',
      target_id: applicantId,
      detail: `Created portal access for ${name} (${email}) — WARNING: email send failed`,
    });

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        portal_user_id: portalUserId,
        email_sent: false,
        candidate_name: name,
        candidate_email: email,
        temp_password: tempPassword,
        warning: 'Portal account created but email failed to send. Share the password manually.',
      },
    };
  }

  logAudit({
    user_id: actor.id,
    user_name: actor.name,
    action: 'create_candidate_access',
    module: 'recruitment',
    target_type: 'hr.applicant',
    target_id: applicantId,
    detail: `Created portal access for ${name} (${email}) — email sent`,
  });

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      portal_user_id: portalUserId,
      email_sent: true,
      candidate_name: name,
      candidate_email: email,
    },
  };
}

export function promoteApplicantToEmployee(
  applicantId: number,
  employeeId: number,
  actor: Actor,
): PromoteResponse {
  if (!applicantId || !Number.isFinite(applicantId)) {
    return { ok: false, status: 400, body: { error: 'applicant_id is required' } };
  }
  if (!employeeId || !Number.isFinite(employeeId)) {
    return { ok: false, status: 400, body: { error: 'employee_id is required' } };
  }

  const user = getUserByApplicantId(applicantId);
  if (!user) {
    return {
      ok: false,
      status: 404,
      body: { error: 'No portal user linked to this applicant_id' },
    };
  }

  updateUser(user.id, { employee_id: employeeId });

  logAudit({
    user_id: actor.id,
    user_name: actor.name,
    action: 'promote_candidate_to_employee',
    module: 'recruitment',
    target_type: 'hr.applicant',
    target_id: applicantId,
    detail: `Linked portal user ${user.id} (${user.email}) to hr.employee ${employeeId}`,
  });

  return {
    ok: true,
    status: 200,
    body: { success: true, portal_user_id: user.id },
  };
}
