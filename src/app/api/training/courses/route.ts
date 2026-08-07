import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listCourses, createCourse } from '@/lib/training';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Training courses — list and create.
 *
 * A course only ever POINTS at guides, so nothing here can disturb a guide's
 * content or the frozen copy on a day's task list.
 */
export const dynamic = 'force-dynamic';

const MAX_NAME = 120;

export async function GET() {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireRole('manager');
    const courses = await listCourses(parseCompanyIds(user.allowed_company_ids));
    const res = NextResponse.json({ ok: true, courses });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[training] GET courses error:', err);
    return NextResponse.json({ error: 'Could not load courses' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireRole('manager');
    const body = await req.json();
    const name = String(body?.name ?? '').trim().slice(0, MAX_NAME);
    if (!name) return NextResponse.json({ error: 'Give the course a name.' }, { status: 400 });

    // The active company from the header pill, same as the guide library does.
    const companyId = Number(cookies().get('kw_company_id')?.value || 0);
    if (!companyId) {
      return NextResponse.json({ error: 'Pick a restaurant first.' }, { status: 400 });
    }
    // The gate every screen uses — true for an admin regardless of their list.
    if (!userCompanyAllowed(user, companyId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Odoo is given the company that was just authorised, so its own
    // fail-closed check agrees with this one rather than contradicting it.
    const made = await createCourse(name, companyId, [companyId]);
    if (!made) return NextResponse.json({ error: 'Could not create the course.' }, { status: 500 });
    return NextResponse.json({ ok: true, ...made });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[training] POST course error:', err);
    return NextResponse.json({ error: 'Could not create the course' }, { status: 500 });
  }
}
