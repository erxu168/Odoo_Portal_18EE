import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { listUsers, createUser, getUserByEmail } from '@/lib/db';

/**
 * GET /api/admin/users
 * List all portal users. Admin only.
 */
export async function GET() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const users = listUsers();
  return NextResponse.json({ users });
}

/**
 * POST /api/admin/users
 * Create a new portal user. Admin only.
 */
export async function POST(request: Request) {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const { name, email, password, role } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required.' },
        { status: 400 },
      );
    }

    if (!['staff', 'manager', 'admin'].includes(role || 'staff')) {
      return NextResponse.json(
        { error: 'Role must be staff, manager, or admin.' },
        { status: 400 },
      );
    }

    // Check duplicate email
    const existing = getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 },
      );
    }

    const id = createUser(name, email, password, role || 'staff');
    return NextResponse.json({ id, message: 'User created' }, { status: 201 });
  } catch (error: unknown) {
    console.error('POST /api/admin/users error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create user' },
      { status: 500 },
    );
  }
}
