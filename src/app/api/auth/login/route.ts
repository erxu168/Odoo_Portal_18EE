import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createSession } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { COOKIE_NAME } from '@/lib/auth';

/**
 * POST /api/auth/login
 * Authenticates a portal user and creates a session.
 * Checks status: pending shows contact info, rejected blocks.
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

    const user = getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    // Check account status
    if (user.status === 'pending') {
      // Get department manager name for contact info
      let contactName = 'Ethan';
      if (user.employee_id) {
        try {
          const odoo = getOdoo();
          const emps = await odoo.searchRead('hr.employee',
            [['id', '=', user.employee_id]],
            ['department_id'],
            { limit: 1 }
          );
          if (emps && emps[0]?.department_id) {
            const depts = await odoo.searchRead('hr.department',
              [['id', '=', emps[0].department_id[0]]],
              ['manager_id'],
              { limit: 1 }
            );
            if (depts && depts[0]?.manager_id) {
              contactName = depts[0].manager_id[1];
            }
          }
        } catch (e) {
          // fallback to Ethan
        }
      }

      return NextResponse.json({
        error: 'Your account is pending approval.',
        code: 'PENDING',
        contact: contactName,
      }, { status: 403 });
    }

    if (user.status === 'rejected') {
      return NextResponse.json({
        error: 'Your registration was not approved. Contact your manager if you believe this is an error.',
        code: 'REJECTED',
      }, { status: 403 });
    }

    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Account is not active.' },
        { status: 403 },
      );
    }

    // Create session (also increments login_count)
    const token = createSession(user.id);

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        login_count: user.login_count + 1,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
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
