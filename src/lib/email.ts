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
