import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listLibraryGuides, createLibraryGuide } from '@/lib/task-guide';
import { userCompanyAllowed } from '@/lib/company-scope';

export const dynamic = 'force-dynamic';

const MAX_NAME = 120;

// GET — every guide in the manager's companies, for the Library screen.
export async function GET() {
  try {
    const user = requireRole('manager');
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const guides = await listLibraryGuides(allowed);
    const res = NextResponse.json({ guides });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guides error:', err);
    return NextResponse.json({ error: 'Failed to load guides' }, { status: 500 });
  }
}

// POST — create an empty draft guide in one of the manager's companies.
export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const body = await req.json();
    const name = String(body?.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'A guide needs a name.' }, { status: 400 });
    if (name.length > MAX_NAME) return NextResponse.json({ error: 'That name is too long.' }, { status: 400 });
    let companyId = Number(body?.company_id);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      // Default to the sole assigned company; otherwise the caller must choose.
      if (allowed.length === 1) companyId = allowed[0];
      else return NextResponse.json({ error: 'Choose a company for this guide.' }, { status: 400 });
    }
    // Fail CLOSED: a non-admin may only create in a company they're assigned to.
    if (!userCompanyAllowed(user, companyId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const created = await createLibraryGuide(name, companyId);
    return NextResponse.json({ ok: true, id: created.id, revision: created.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] POST guide error:', err);
    const message = err instanceof Error ? err.message : 'Failed to create guide';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
