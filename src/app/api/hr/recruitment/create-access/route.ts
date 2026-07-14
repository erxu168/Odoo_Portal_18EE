import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { createApplicantPortalAccess } from '@/lib/hr/recruitment';

/**
 * POST /api/hr/recruitment/create-access
 * Cookie-authenticated. Managers only. For portal-side UI.
 *
 * Body: { applicant_id: number }
 */
export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { applicant_id } = await req.json();

    const result = await createApplicantPortalAccess(applicant_id, {
      id: user.id,
      name: user.name,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/hr/recruitment/create-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create portal access' },
      { status: 500 },
    );
  }
}
