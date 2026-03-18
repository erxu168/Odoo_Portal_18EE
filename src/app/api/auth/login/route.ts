import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createSession } from '@/lib/db';
import { COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/auth';

/**
 * POST /api/auth/login
 * Authenticates a portal user and creates a session.
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      );
    }

    // Look up user in portal DB
    const user = getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    // Verify password
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    // Create session
    const token = createSession(user.id);

    // Build response with session cookie
    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (error: any) {
    console.error('POST /api/auth/login error:', error);
    return NextResponse.json(
      { error: 'Login failed. Please try again.' },
      { status: 500 },
    );
  }
}
