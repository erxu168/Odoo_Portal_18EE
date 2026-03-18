import { NextResponse } from 'next/server';
import { getUserByEmail, createPasswordResetToken } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email if the user exists.
 * Always returns success (don't reveal if email exists).
 */
export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const user = getUserByEmail(email.toLowerCase().trim());

    if (user) {
      // Create a reset token (expires in 1 hour)
      const token = createPasswordResetToken(user.id);

      // Send email
      try {
        await sendPasswordResetEmail(user.email, user.name, token);
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr);
        return NextResponse.json(
          { error: 'Could not send email. Please try again later or contact your manager.' },
          { status: 500 },
        );
      }
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  } catch (error: any) {
    console.error('POST /api/auth/forgot-password error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
