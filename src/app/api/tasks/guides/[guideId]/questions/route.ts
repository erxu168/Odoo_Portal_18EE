import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
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

/** Returns the guide's company once the caller is allowed to write it.
 *
 *  Handing that company to Odoo — rather than the caller's own list — is what
 *  makes the two checks agree. userCompanyAllowed is true for any admin, but
 *  Odoo's own scope check fails CLOSED against the caller's list, so an admin
 *  whose list did not happen to contain this company was authorised here and
 *  refused there. The route is the tenancy boundary; once it has decided, it
 *  says which company it decided about. */
async function scopeFor(user: PortalUser, id: number): Promise<number> {
  const scope = await getGuideScope(id);
  if (!scope) throw new AuthError('Not found', 404);
  if (!userCompanyAllowed(user, scope.companyId)) throw new AuthError('Forbidden', 403);
  // A guide with no company cannot be scoped, so nobody may write it. 404 not
  // 403: whether such a record exists is not worth telling anyone.
  if (!scope.companyId) throw new AuthError('Not found', 404);
  return scope.companyId;
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
    const companyId = await scopeFor(user, id);

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

    const kept = await saveGuideQuestions(id, questions as GuideQuestion[], [companyId]);
    // null means Odoo refused. Never report a refusal as a success: the manager
    // would close the screen believing their questions were saved.
    if (kept === null) {
      return NextResponse.json({ error: 'The questions were not saved.' }, { status: 500 });
    }
    if (kept < questions.length) {
      // Everything was validated above, so a shortfall means something dropped
      // them silently — say so rather than letting the count quietly disagree.
      return NextResponse.json(
        { error: `Only ${kept} of ${questions.length} questions could be saved.`, kept },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, kept });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide questions error:', err);
    return NextResponse.json({ error: 'Could not save the questions' }, { status: 500 });
  }
}
