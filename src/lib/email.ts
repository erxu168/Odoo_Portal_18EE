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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.strato.de',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // SSL on port 465
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || '',
  },
});

const FROM = process.env.SMTP_FROM || 'noreply@krawings.de';
const PORTAL_URL = process.env.PORTAL_URL || 'http://89.167.124.0:3000';

/**
 * Send a password reset email with a time-limited link.
 */
export async function sendPasswordResetEmail(toEmail: string, toName: string, resetToken: string) {
  const resetUrl = `${PORTAL_URL}/reset-password?token=${resetToken}`;

  await transporter.sendMail({
    from: `"Krawings Portal" <${FROM}>`,
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
      '— Krawings SSAM Korean BBQ',
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px;">SSAM KOREAN BBQ</div>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${toName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Someone requested a password reset for your Krawings Staff Portal account.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #16A34A; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">Reset password</a>
        </div>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">Krawings SSAM Korean BBQ &middot; Staff Portal</p>
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
) {
  const loginUrl = `${PORTAL_URL}/login`;

  await transporter.sendMail({
    from: `"Krawings Portal" <${FROM}>`,
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
      '\u2014 Krawings SSAM Korean BBQ',
    ].join('\n'),
    html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="font-size: 24px; font-weight: 700; color: #1A1F2E;">KRAWINGS</div>
          <div style="font-size: 12px; color: #9CA3AF; margin-top: 4px;">SSAM KOREAN BBQ</div>
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
        <p style="color: #9CA3AF; font-size: 11px; text-align: center;">Krawings SSAM Korean BBQ &middot; Staff Portal</p>
      </div>
    `,
  });
}
