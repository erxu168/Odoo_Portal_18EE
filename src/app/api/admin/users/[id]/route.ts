import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getUserById, updateUser, resetPassword } from '@/lib/db';

/**
 * PATCH /api/admin/users/[id]
 * Update a user (role, active, name, allowed_company_ids) or reset password. Admin only.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const userId = parseInt(params.id);
    const user = getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();

    // Reset password
    if (body.new_password) {
      resetPassword(userId, body.new_password);
    }

    // Update fields
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.active !== undefined) updates.active = body.active ? 1 : 0;
    if (body.employee_id !== undefined) updates.employee_id = body.employee_id;
    if (body.status !== undefined) updates.status = body.status;
    if (body.allowed_company_ids !== undefined) {
      // Validate: must be array of numbers
      if (Array.isArray(body.allowed_company_ids) && body.allowed_company_ids.every((id: any) => typeof id === 'number')) {
        updates.allowed_company_ids = body.allowed_company_ids;
      } else {
        return NextResponse.json({ error: 'allowed_company_ids must be an array of numbers' }, { status: 400 });
      }
    }

    if (Object.keys(updates).length > 0) {
      updateUser(userId, updates);
    }

    const updated = getUserById(userId);
    return NextResponse.json({ user: updated });
  } catch (error: any) {
    console.error(`PATCH /api/admin/users/${params.id} error:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 500 },
    );
  }
}
