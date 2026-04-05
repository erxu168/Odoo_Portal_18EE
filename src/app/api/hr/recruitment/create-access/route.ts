import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { createUser, getUserByApplicantId, getUserByEmail, logAudit } from '@/lib/db';
import { sendCandidateWelcomeEmail } from '@/lib/email';

function generateTempPassword(length = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/**
 * POST /api/hr/recruitment/create-access
 * Creates a portal account for an applicant and sends welcome email.
 * Requires manager role.
 *
 * Body: { applicant_id: number }
 */
export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { applicant_id } = await req.json();
    if (!applicant_id) {
      return NextResponse.json({ error: 'applicant_id is required' }, { status: 400 });
    }

    // Check if applicant already has portal access
    const existing = getUserByApplicantId(applicant_id);
    if (existing) {
      return NextResponse.json({
        error: 'This applicant already has portal access',
        portal_user_id: existing.id,
      }, { status: 409 });
    }

    // Fetch applicant from Odoo
    const odoo = getOdoo();

    const applicants = await odoo.searchRead('hr.applicant', [
      ['id', '=', applicant_id],
    ], ['partner_name', 'email_from', 'partner_id', 'job_id', 'stage_id', 'department_id'], { limit: 1 });

    if (!applicants || applicants.length === 0) {
      return NextResponse.json({ error: 'Applicant not found in Odoo' }, { status: 404 });
    }

    const applicant = applicants[0];
    const name = applicant.partner_name || 'Candidate';
    const email = applicant.email_from;
    const jobName = applicant.job_id ? applicant.job_id[1] : 'Open Position';

    if (!email) {
      return NextResponse.json({ error: 'Applicant has no email address in Odoo' }, { status: 400 });
    }

    // Check if email already used by another portal user
    const emailUser = getUserByEmail(email);
    if (emailUser) {
      return NextResponse.json({
        error: `Email ${email} is already registered to another portal user (${emailUser.name})`,
      }, { status: 409 });
    }

    // Create portal user with temp password
    const tempPassword = generateTempPassword();
    const portalUserId = createUser(name, email, tempPassword, 'staff', {
      applicant_id,
      must_change_password: true,
      status: 'active',
    });

    // Send welcome email
    try {
      await sendCandidateWelcomeEmail(email, name, tempPassword, jobName);
    } catch (emailErr: unknown) {
      console.error('Failed to send welcome email:', emailErr);
      // Account was created, just warn about email
      logAudit({
        user_id: user.id,
        user_name: user.name,
        action: 'create_candidate_access',
        module: 'recruitment',
        target_type: 'hr.applicant',
        target_id: applicant_id,
        detail: `Created portal access for ${name} (${email}) — WARNING: email send failed`,
      });

      return NextResponse.json({
        success: true,
        portal_user_id: portalUserId,
        email_sent: false,
        warning: 'Account created but email failed. Use admin panel to reset password.',
      });
    }

    logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'create_candidate_access',
      module: 'recruitment',
      target_type: 'hr.applicant',
      target_id: applicant_id,
      detail: `Created portal access for ${name} (${email}) — email sent`,
    });

    return NextResponse.json({
      success: true,
      portal_user_id: portalUserId,
      email_sent: true,
      candidate_name: name,
      candidate_email: email,
    });
  } catch (err: unknown) {
    console.error('POST /api/hr/recruitment/create-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create portal access' },
      { status: 500 },
    );
  }
}
