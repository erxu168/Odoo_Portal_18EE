/**
 * Email service — sends transactional emails via Strato SMTP.
 *
 * Required env vars in .env.local:
 *   SMTP_HOST=smtp.strato.de
 *   SMTP_PORT=465
 *   SMTP_USER=noreply@krawings.de
 *   SMTP_PASSWORD=<your email password>
 *   SMTP_FROM=noreply@krawings.de
 *   PORTAL_URL=http://89.167.124.0:3000
 */
import nodemailer from 'nodemailer';
import { resolveCompanySetting } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

/**
 * Restaurant display name for a company, used for email branding under the
 * KRAWINGS wordmark. Reads res.company and strips a trailing "(…)" address
 * suffix. Falls back to a neutral label so an unknown or omitted company never
 * shows the wrong restaurant's name.
 */
async function getCompanyBrandName(companyId?: number): Promise<string> {
  if (!companyId) return 'Staff Portal';
  try {
    const rows = (await getOdoo().read('res.company', [companyId], ['name'])) as Array<Record<string, unknown>>;
    const raw = rows?.[0]?.name;
    if (typeof raw === 'string' && raw.trim()) {
      return raw.replace(/\s*\(.*\)\s*$/, '').trim() || raw.trim();
    }
  } catch {
    /* fall through to neutral label */
  }
  return 'Staff Portal';
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Resolve SMTP config for a company: admin-set per-company settings → the
 * "default (all restaurants)" settings (company 0) → env vars → Strato defaults.
 * Works with any SMTP provider (Strato, Gmail app-password, custom, …).
 */
export function getEmailConfig(companyId?: number): EmailConfig {
  const s = (key: string) => resolveCompanySetting(companyId, key);
  const host = s('smtp_host') || process.env.SMTP_HOST || 'smtp.strato.de';
  const port = parseInt(s('smtp_port') || process.env.SMTP_PORT || '465', 10);
  const secureRaw = s('smtp_secure');
  const secure = secureRaw !== null ? secureRaw === '1' : port === 465; // 465=SSL, 587=STARTTLS
  const user = s('smtp_user') || process.env.SMTP_USER || '';
  const pass = s('smtp_password') || process.env.SMTP_PASSWORD || '';
  const from = s('smtp_from') || process.env.SMTP_FROM || user || 'noreply@krawings.de';
  return { host, port, secure, user, pass, from };
}

function getTransporter(companyId?: number) {
  const c = getEmailConfig(companyId);
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
  });
}

function getFrom(companyId?: number): string {
  return getEmailConfig(companyId).from;
}

const PORTAL_URL = process.env.PORTAL_URL || 'http://89.167.124.0:3000';

/** True only when SMTP credentials are configured (per-company, default, or env). */
export function isEmailConfigured(companyId?: number): boolean {
  const c = getEmailConfig(companyId);
  return !!(c.user && c.pass);
}

/** Send a test email to verify a company's SMTP settings. Throws the SMTP error on failure. */
export async function sendTestEmail(toEmail: string, companyId?: number): Promise<void> {
  await getTransporter(companyId).sendMail({
    from: `"Krawings Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: 'Krawings Portal — test email',
    text: 'This is a test email from the Krawings Portal. If you received this, your email settings are working.',
    html: '<p>This is a <b>test email</b> from the Krawings Portal. If you received this, your email settings are working. ✅</p>',
  });
}

/** Email a composed purchase order to a supplier. Throws on SMTP failure (caller should catch). */
export async function sendOrderEmail(toEmail: string, subject: string, textBody: string, htmlBody: string, companyId?: number) {
  await getTransporter(companyId).sendMail({
    from: `"Krawings Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

/**
 * Send a password reset email with a time-limited link.
 */
export async function sendPasswordResetEmail(toEmail: string, toName: string, resetToken: string, companyId?: number) {
  const resetUrl = `${PORTAL_URL}/reset-password?token=${resetToken}`;
  const brand = await getCompanyBrandName(companyId);

  await getTransporter(companyId).sendMail({
    from: `"Krawings Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: 'Reset your Krawings Portal password',
    text: [
      `Hi ${toName},`,
      '',
      'Someone requested a password reset for your Krawings Staff Portal account.',
      '',
      'Click the link below to set a new password:',
      resetUrl,
      '',
      'This link expires in 1 hour.',
      '',
      'If you did not request this, ignore this email.',
      '',
      `— Krawings ${brand}`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px;">${brand.toUpperCase()}</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Someone requested a password reset for your Krawings Staff Portal account.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Reset password</a>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">Krawings ${brand} &middot; Staff Portal</p>
      </div>
    `,
  });
}


/**
 * Send portal access credentials to a new candidate.
 */
export async function sendCandidateWelcomeEmail(
  toEmail: string,
  toName: string,
  tempPassword: string,
  jobName: string,
  companyId?: number,
) {
  const loginUrl = `${PORTAL_URL}/login`;
  const brand = await getCompanyBrandName(companyId);

  await getTransporter(companyId).sendMail({
    from: `"Krawings Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: 'Your Krawings Portal access is ready',
    text: [
      `Hi ${toName},`,
      '',
      `Welcome! You have been granted access to the Krawings Staff Portal as part of your application for ${jobName}.`,
      '',
      'Here are your login details:',
      `  Email: ${toEmail}`,
      `  Temporary password: ${tempPassword}`,
      '',
      'Please log in and change your password immediately:',
      loginUrl,
      '',
      'You can use the portal to track your application status and, once approved, complete your onboarding paperwork.',
      '',
      `\u2014 Krawings ${brand}`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px;">${brand.toUpperCase()}</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Welcome! You have been granted access to the Krawings Staff Portal as part of your application for <strong>${jobName}</strong>.</p>
        <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin: 20px 0;">
          <div style="font-size: 13px; color: #6B7280; margin-bottom: 8px;">Your login details:</div>
          <div style="font-size: 14px; color: #111827;"><strong>Email:</strong> ${toEmail}</div>
          <div style="font-size: 14px; color: #111827; margin-top: 6px;"><strong>Temporary password:</strong> <code style="background: #FEF3C7; padding: 2px 8px; border-radius: 4px; font-size: 15px; font-weight: 700;">${tempPassword}</code></div>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${loginUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Log in to Portal</a>
        </div>
        <p style="color: #6B7280; font-size: 13px; line-height: 1.5;">You will be asked to change your password on first login.</p>
        <p style="color: #6B7280; font-size: 13px; line-height: 1.5;">Use the portal to track your application status. Once approved, you can complete your onboarding paperwork directly in the portal.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">Krawings ${brand} &middot; Staff Portal</p>
      </div>
    `,
  });
}


/**
 * Send a staff member their portal invite link (push-provisioning model).
 */
export async function sendStaffInviteEmail(toEmail: string, toName: string, inviteUrl: string, companyId?: number) {
  const brand = await getCompanyBrandName(companyId);
  await getTransporter(companyId).sendMail({
    from: `"Krawings Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: 'Set up your Krawings Staff Portal account',
    text: [
      `Hi ${toName},`,
      '',
      'Welcome to the Krawings Staff Portal. Tap the link below to set up your account and choose a password:',
      inviteUrl,
      '',
      'This link is just for you and expires in 14 days.',
      '',
      'If you were not expecting this, you can ignore this email.',
      '',
      `— Krawings ${brand}`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px;">${brand.toUpperCase()}</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Welcome to the Krawings Staff Portal! Tap the button below to set up your account and choose a password.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Set up my account</a>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This link is just for you and expires in 14 days. If you were not expecting this, you can ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">Krawings ${brand} &middot; Staff Portal</p>
      </div>
    `,
  });
}
