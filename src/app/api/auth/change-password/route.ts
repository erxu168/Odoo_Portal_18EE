import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, resetPassword } from '@/lib/db';

/**
 * POST /api/auth/change-password
 * Changes password for the logged-in user.
 * Requires current password verification.
 */
export async function POST(request: Request) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { current_password, new_password } = await request.json();

    if (!current_password || !new_password) {
      return NextResponse.json(
        { error: 'Current and new password are required.' },
        { status: 400 },
      );
    }

    if (new_password.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters.' },
        { status: 400 },
      );
    }

    if (!/\d/.test(new_password)) {
      return NextResponse.json(
        { error: 'New password must contain at least one number.' },
        { status: 400 },
      );
    }

    // Verify current password
    const fullUser = getUserByEmail(user.email);
    if (!fullUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const valid = bcrypt.compareSync(current_password, fullUser.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Current password is incorrect.' },
        { status: 403 },
      );
    }

    // Set new password
    resetPassword(user.id, new_password);

    return NextResponse.json({ message: 'Password changed successfully.' });
  } catch (error: any) {
    console.error('POST /api/auth/change-password error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
