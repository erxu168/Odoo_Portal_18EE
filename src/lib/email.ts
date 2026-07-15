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


/** What the SMTP server told us about a send — proof the mail left our server. */
export interface MailSendResult {
  accepted: string[];
  rejected: string[];
  response: string;
  messageId: string;
}

/**
 * Send a staff member their portal invite link (push-provisioning model).
 * Returns the SMTP result so callers can show real "it left the mail server"
 * confirmation (accepted recipients + the server's response, e.g. "250 OK").
 */
export async function sendStaffInviteEmail(toEmail: string, toName: string, inviteUrl: string, companyId?: number, locationName?: string): Promise<MailSendResult> {
  // The restaurant/location name staff will recognise. Prefer the employee's
  // department (the actual restaurant, e.g. "What a Jerk"), since a new hire's
  // legal Company is usually the umbrella entity and would name the wrong place.
  // Fall back to the company brand, then to "Krawings", so the sender, subject
  // and body always name somewhere the person recognises (a generic
  // "Krawings Staff Portal" reads as spam to new hires).
  const explicit = (locationName || '').trim();
  const brand = explicit || await getCompanyBrandName(companyId);
  const location = brand && brand !== 'Staff Portal' ? brand : 'Krawings';
  const info = await getTransporter(companyId).sendMail({
    from: `"${location} Staff Portal" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: `Set up your ${location} staff portal account`,
    text: [
      `Hi ${toName},`,
      '',
      `You have been added to the team at ${location}. Welcome!`,
      '',
      `This is your staff portal account for ${location} — where you can see your shifts, hours, documents and personal details. Tap the link below to set it up and choose a password:`,
      inviteUrl,
      '',
      'This link is just for you and expires in 14 days.',
      '',
      `You are receiving this because a manager at ${location} added you to the staff portal. If you were not expecting it, you can ignore this email.`,
      '',
      `— ${location} · Krawings Staff Portal`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 13px; color: #16A34A; font-weight: 700; margin-top: 4px; letter-spacing: 0.02em;">${location}</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">You have been added to the team at <strong>${location}</strong>. This is your staff portal account for ${location}, where you can see your shifts, hours, documents and personal details.</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Tap the button below to set up your account and choose a password.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Set up my account</a>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This link is just for you and expires in 14 days. You are receiving this because a manager at ${location} added you to the staff portal. If you were not expecting it, you can ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">${location} · Krawings Staff Portal</p>
      </div>
    `,
  });
  return {
    accepted: (info.accepted || []).map(String),
    rejected: (info.rejected || []).map(String),
    response: typeof info.response === 'string' ? info.response : '',
    messageId: info.messageId || '',
  };
}

/**
 * Kiosk time clock: email a 6-digit code the staff member types into the tablet to
 * set up their PIN for the first time.
 */
export async function sendKioskSetupCodeEmail(toEmail: string, toName: string, code: string, companyId?: number) {
  const brand = await getCompanyBrandName(companyId);
  await getTransporter(companyId).sendMail({
    from: `"${brand} Time Clock" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: `Your ${brand} Time Clock setup code: ${code}`,
    text: [
      `Hi ${toName},`,
      '',
      `Your Time Clock PIN setup code is: ${code}`,
      '',
      'Type this code into the tablet, then choose your own 4-digit PIN.',
      '',
      'This code expires in 15 minutes. If you did not request this, ignore this email.',
      '',
      `— ${brand} Time Clock`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 26px; font-weight: 800; color: #1A1F2E;">${brand}</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px; letter-spacing: 1px;">TIME CLOCK</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Here is your code to set up your <b>${brand}</b> Time Clock PIN. Type it into the tablet, then choose your own 4-digit PIN.</p>
        <div style="text-align: center; margin: 28px 0;">
          <div style="display: inline-block; padding: 16px 28px; background-color: #F3F4F6; border-radius: 12px; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #1A1F2E;">${code}</div>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This code expires in 15 minutes. If you did not request this, ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">${brand} &middot; Time Clock</p>
      </div>
    `,
  });
}

/**
 * Kiosk time clock: email a reset link so a staff member who forgot their PIN can
 * set a new one (opened on their own phone).
 */
export async function sendKioskPinResetEmail(toEmail: string, toName: string, resetToken: string, companyId?: number) {
  const resetUrl = `${PORTAL_URL}/kiosk/reset-pin?token=${resetToken}`;
  const brand = await getCompanyBrandName(companyId);
  await getTransporter(companyId).sendMail({
    from: `"${brand} Time Clock" <${getFrom(companyId)}>`,
    to: toEmail,
    subject: `Reset your ${brand} Time Clock PIN`,
    text: [
      `Hi ${toName},`,
      '',
      `A request to reset the Time Clock PIN for ${toName} was made at the ${brand} tablet.`,
      '',
      'Open the link below on your phone to choose a new 4-digit PIN:',
      resetUrl,
      '',
      `Didn't request this? If it wasn't you, ignore this email — your current PIN still works — and let your manager know.`,
      '',
      'This link expires in 1 hour.',
      '',
      `— ${brand} Time Clock`,
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 26px; font-weight: 800; color: #1A1F2E;">${brand}</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px; letter-spacing: 1px;">TIME CLOCK</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">A request to reset the Time Clock PIN for <b>${toName}</b> was made at the <b>${brand}</b> tablet. Tap the button to choose a new 4-digit PIN.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Set a new PIN</a>
        </div>
        <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 12px 16px; margin: 8px 0 16px;">
          <p style="color: #B91C1C; font-size: 13px; line-height: 1.5; margin: 0;"><b>Didn't request this?</b> If it wasn't you, don't tap the button — ignore this email (your current PIN still works) and let your manager know.</p>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This link expires in 1 hour.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">${brand} &middot; Time Clock</p>
      </div>
    `,
  });
}
