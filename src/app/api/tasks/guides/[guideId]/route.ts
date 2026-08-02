import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { getGuideScope } from '@/lib/odoo-tasks';
import { readLibraryGuide, saveLibraryGuide, deleteLibraryGuide } from '@/lib/task-guide';
import { sanitizeSteps } from '@/lib/task-guide-validate';
import { userCompanyAllowed } from '@/lib/company-scope';

export const dynamic = 'force-dynamic';

const MAX_NAME = 120;

function guideId(params: { guideId: string }): number | null {
  const id = parseInt(params.guideId, 10);
  return Number.isNaN(id) ? null : id;
}

/** The guide must exist and belong to one of the user's companies (admin: any).
 * Fails CLOSED for an empty/mismatched scope. */
async function assertScope(user: PortalUser, id: number): Promise<void> {
  const scope = await getGuideScope(id);
  if (!scope) throw new AuthError('Not found', 404);
  if (!userCompanyAllowed(user, scope.companyId)) throw new AuthError('Forbidden', 403);
}

export async function GET(_req: NextRequest, { params }: { params: { guideId: string } }) {
  try {
    const user = requireRole('manager');
    const id = guideId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, id);
    const guide = await readLibraryGuide(id);
    if (!guide) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const res = NextResponse.json(guide);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guide error:', err);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { guideId: string } }) {
  try {
    const user = requireRole('manager');
    const id = guideId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, id);
    const body = await req.json();
    const revision = Number(body?.revision);
    if (!Number.isInteger(revision)) return NextResponse.json({ error: 'Missing revision' }, { status: 400 });
    const published = !!body?.published;
    let name: string | undefined;
    if (body?.name !== undefined) {
      name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'A guide needs a name.' }, { status: 400 });
      if (name.length > MAX_NAME) return NextResponse.json({ error: 'That name is too long.' }, { status: 400 });
    }
    const steps = sanitizeSteps(body?.steps, published);
    const result = await saveLibraryGuide(id, revision, published, steps, name);
    if (result?.conflict) {
      return NextResponse.json(
        { error: 'This guide was changed in another window. Reload and try again.', revision: result.revision },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide error:', err);
    const message = err instanceof Error ? err.message : 'Failed to save guide';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { guideId: string } }) {
  try {
    const user = requireRole('manager');
    const id = guideId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, id);
    await deleteLibraryGuide(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] DELETE guide error:', err);
    const message = err instanceof Error ? err.message : 'Failed to delete guide';
    // Only "a task still links this guide" is a genuine conflict (409); anything
    // else (outage, malformed response) is a 500 so it isn't shown as "in use".
    const isConflict = /used by|detach/i.test(message);
    return NextResponse.json({ error: message }, { status: isConflict ? 409 : 500 });
  }
}
