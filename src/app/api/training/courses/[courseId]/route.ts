import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { readCourse, saveCourse, deleteCourse, type CourseSave } from '@/lib/training';
import { parseCompanyIds } from '@/lib/db';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';

/** Read, save and delete one course. */
export const dynamic = 'force-dynamic';

const MAX_CHAPTERS = 30;
const MAX_GUIDES_PER_CHAPTER = 30;

export async function GET(_req: NextRequest, { params }: { params: { courseId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireRole('manager');
    const id = parseInt(params.courseId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const course = await readCourse(id, parseCompanyIds(user.allowed_company_ids));
    if (!course) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!userCompanyAllowed(user, course.company_id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, course });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[training] GET course error:', err);
    return NextResponse.json({ error: 'Could not load the course' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { courseId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireRole('manager');
    const id = parseInt(params.courseId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const existing = await readCourse(id, parseCompanyIds(user.allowed_company_ids));
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!userCompanyAllowed(user, existing.company_id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const revision = Number(body?.revision);
    if (!Number.isInteger(revision)) {
      return NextResponse.json({ error: 'revision is required' }, { status: 400 });
    }

    const payload = (body?.payload ?? {}) as CourseSave;
    if (payload.chapters) {
      if (payload.chapters.length > MAX_CHAPTERS) {
        return NextResponse.json({ error: `A course can hold at most ${MAX_CHAPTERS} chapters.` }, { status: 400 });
      }
      for (const ch of payload.chapters) {
        if ((ch.guides || []).length > MAX_GUIDES_PER_CHAPTER) {
          return NextResponse.json(
            { error: `A chapter can hold at most ${MAX_GUIDES_PER_CHAPTER} guides.` },
            { status: 400 },
          );
        }
      }
    }
    if (payload.pass_mark !== undefined && (payload.pass_mark < 1 || payload.pass_mark > 100)) {
      return NextResponse.json({ error: 'The pass mark must be between 1 and 100 percent.' }, { status: 400 });
    }

    const result = await saveCourse(id, revision, payload, [existing.company_id]);
    if (!result.ok) {
      if (result.error === 'stale') {
        // Someone else saved while this editor was open. Never overwrite work
        // that is not on this screen.
        return NextResponse.json(
          { error: 'Someone else saved this course. Reload it and make your change again.', revision: result.revision },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[training] PUT course error:', err);
    return NextResponse.json({ error: 'Could not save the course' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { courseId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireRole('manager');
    const id = parseInt(params.courseId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const existing = await readCourse(id, parseCompanyIds(user.allowed_company_ids));
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!userCompanyAllowed(user, existing.company_id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const ok = await deleteCourse(id, [existing.company_id]);
    if (!ok) return NextResponse.json({ error: 'Could not delete the course' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[training] DELETE course error:', err);
    return NextResponse.json({ error: 'Could not delete the course' }, { status: 500 });
  }
}
