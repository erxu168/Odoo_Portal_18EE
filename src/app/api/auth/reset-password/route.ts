import { NextResponse } from 'next/server';
import { verifyPasswordResetToken, resetPassword, deletePasswordResetToken } from '@/lib/db';

/**
 * POST /api/auth/reset-password
 * Verifies a reset token and sets a new password.
 */
export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and new password are required.' },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 },
      );
    }

    if (!/\d/.test(password)) {
      return NextResponse.json(
        { error: 'Password must contain at least one number.' },
        { status: 400 },
      );
    }

    // Verify the token
    const userId = verifyPasswordResetToken(token);
    if (!userId) {
      return NextResponse.json(
        { error: 'This reset link has expired or is invalid. Please request a new one.' },
        { status: 400 },
      );
    }

    // Set new password
    resetPassword(userId, password);

    // Delete the used token
    deletePasswordResetToken(token);

    return NextResponse.json({ message: 'Password has been reset. You can now sign in.' });
  } catch (error: unknown) {
    console.error('POST /api/auth/reset-password error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
