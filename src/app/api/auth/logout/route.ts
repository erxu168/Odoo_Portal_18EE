import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/db';
import { COOKIE_NAME } from '@/lib/auth';

/**
 * POST /api/auth/logout
 * Destroys the session and clears the cookie.
 */
export async function POST() {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (token) {
      deleteSession(token);
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error: unknown) {
    console.error('POST /api/auth/logout error:', error);
    return NextResponse.json({ ok: true });
  }
}
