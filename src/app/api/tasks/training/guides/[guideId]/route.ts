import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError, type PortalUser } from '@/lib/auth';
import { getGuideScope } from '@/lib/odoo-tasks';
import { readLibraryGuide } from '@/lib/task-guide';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

/** Staff may open a guide only if it is PUBLISHED and in one of their companies.
 * A draft (or other-company / no-scope) guide is a 404 for staff — never leaked. */
async function assertStaffScope(user: PortalUser, guideId: number): Promise<void> {
  const scope = await getGuideScope(guideId);
  if (!scope || !scope.published) throw new AuthError('Not found', 404);
  if (!userCompanyAllowed(user, scope.companyId)) throw new AuthError('Not found', 404);
}

// GET — a published guide's steps for the staff Training player (no media bytes;
// those come from the per-step media route).
export async function GET(_req: NextRequest, { params }: { params: { guideId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const id = parseInt(params.guideId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertStaffScope(user, id);
    const guide = await readLibraryGuide(id);
    if (!guide) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Staff shape: identity + steps only (no company/revision/usage internals).
    const res = NextResponse.json({
      id: guide.id,
      name: guide.name,
      steps: guide.steps.map(s => ({
        id: s.id,
        media_type: s.media_type,
        explanation: s.explanation,
        has_image: s.has_image,
        has_pdf: s.has_pdf,
        pdf_filename: s.pdf_filename,
        youtube_url: s.youtube_url,
        // The author's drawn marks belong to the photo — a staff member reading
        // this in Training must see exactly what the daily task shows.
        drawings: s.drawings,
        pins: s.pins.map(p => ({ pin_x: p.pin_x, pin_y: p.pin_y, note: p.note })),
      })),
    });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET training guide error:', err);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }
}
