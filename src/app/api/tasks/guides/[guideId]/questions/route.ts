import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getGuideScope } from '@/lib/odoo-tasks';
import { userCompanyAllowed } from '@/lib/company-scope';
import { saveGuideQuestions, type GuideQuestion } from '@/lib/task-guide';
import { moduleForbidden } from '@/lib/module-access';

/**
 * PUT — replace a guide's questions.
 *
 * Its own endpoint rather than a field on the guide save, because that save is
 * an atomic rebuild of every step and its media. Questions change on a
 * different rhythm — an author rewords one without touching a photo — and a
 * mistake here must not be able to cost anyone their step images.
 */
export const dynamic = 'force-dynamic';

const MAX_QUESTIONS = 20;
const MAX_ANSWERS = 6;

async function assertScope(user: PortalUser, id: number): Promise<void> {
  const scope = await getGuideScope(id);
  if (!scope) throw new AuthError('Not found', 404);
  if (!userCompanyAllowed(user, scope.companyId)) throw new AuthError('Forbidden', 403);
}

/** Says what is wrong in the author's terms, rather than dropping it silently:
 *  a question that vanished on save reads as data loss. */
function problemWith(q: unknown, i: number): string | null {
  const x = q as Partial<GuideQuestion> | null;
  const n = i + 1;
  if (!x || typeof x.text !== 'string' || !x.text.trim()) return `Question ${n} has no wording.`;
  if (!Array.isArray(x.answers) || x.answers.length < 2) {
    return `Question ${n} needs at least two answers to choose between.`;
  }
  if (x.answers.length > MAX_ANSWERS) return `Question ${n} has too many answers.`;
  if (x.answers.some(a => !a || typeof a.text !== 'string' || !a.text.trim())) {
    return `Question ${n} has a blank answer.`;
  }
  const correct = x.answers.filter(a => a && a.is_correct === true).length;
  if (correct === 0) return `Question ${n} has no correct answer marked.`;
  if (correct > 1) return `Question ${n} has ${correct} correct answers — mark exactly one.`;
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: { guideId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireRole('manager');
    const id = parseInt(params.guideId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, id);

    const body = await req.json();
    const questions = Array.isArray(body?.questions) ? body.questions : null;
    if (!questions) return NextResponse.json({ error: 'questions must be a list' }, { status: 400 });
    if (questions.length > MAX_QUESTIONS) {
      return NextResponse.json(
        { error: `A guide can hold at most ${MAX_QUESTIONS} questions.` },
        { status: 400 },
      );
    }
    for (let i = 0; i < questions.length; i++) {
      const problem = problemWith(questions[i], i);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const kept = await saveGuideQuestions(id, questions as GuideQuestion[], parseCompanyIds(user.allowed_company_ids));
    return NextResponse.json({ ok: true, kept });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide questions error:', err);
    return NextResponse.json({ error: 'Could not save the questions' }, { status: 500 });
  }
}
