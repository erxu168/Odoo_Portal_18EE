import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds, logAudit, countAuditToday } from '@/lib/db';
import { userCompanyAllowed } from '@/lib/company-scope';
import { getGuideScope } from '@/lib/odoo-tasks';
import { readLibraryGuide, getStepMedia } from '@/lib/task-guide';
import { richTextToPlain } from '@/lib/rich-text';
import { improveGuide, MAX_BULLETS, type ExistingStep, type GuideWriterUsage } from '@/lib/ai/guide-writer';
import { checkRateLimit } from '@/lib/rate-limit';
import { moduleForbidden } from '@/lib/module-access';

/**
 * POST — propose better wording for the weak steps of a half-written guide.
 *
 * Returns PROPOSALS and saves nothing. The manager keeps or skips each one in
 * the editor and then presses Save as usual, so nothing AI-written reaches a
 * cook without a person having chosen it twice: once here, once on Save.
 *
 * The photos come from the guide itself, server-side — the browser does not
 * re-upload megabytes it already has on the other end of the wire.
 */
export const dynamic = 'force-dynamic';

const AUDIT_ACTION = 'guide.improve';
const BURST_LIMIT = 5;
const BURST_WINDOW_MS = 10 * 60 * 1000;
const DAILY_LIMIT_PER_USER = 40;
const DAILY_LIMIT_TOTAL = 150;
/** Photos per request, matching the writer. A guide longer than this is better
 *  finished in two passes than paid for in one huge one. */
const MAX_PHOTOS = 12;

const inFlight = new Set<number>();

const FAILURE_MESSAGE: Record<string, string> = {
  'not-configured': 'The AI writer is not switched on for this server yet.',
  refused: 'The assistant would not take this one on. Write the steps by hand.',
  'too-long': 'This guide is long enough that the reply ran out of room. Try it with fewer steps.',
  'bad-output': 'The reply came back unusable. Try again — if it happens twice, the photos may be unclear.',
  error: 'Could not reach the assistant. Check your connection and try again.',
};

function audit(user: PortalUser, detail: Record<string, unknown>) {
  try {
    logAudit({ user_id: user.id, user_name: user.name, action: AUDIT_ACTION, module: 'tasks', detail: JSON.stringify(detail) });
  } catch (e) {
    console.error('[ai] audit log failed for guide improve:', e);
  }
}

export async function POST(req: NextRequest, { params }: { params: { guideId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireRole('manager');
    const id = parseInt(params.guideId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const scope = await getGuideScope(id);
    if (!scope || !scope.companyId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!userCompanyAllowed(user, scope.companyId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const allowed = parseCompanyIds(user.allowed_company_ids);

    const guide = await readLibraryGuide(id);
    if (!guide || !guide.steps.length) {
      return NextResponse.json({ error: 'This guide has no steps yet.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const notes = String(body?.notes ?? '').slice(0, MAX_BULLETS);

    // ── Spend guards, identical in shape to the writer's ──────────────────
    if (inFlight.has(user.id)) {
      return NextResponse.json({ error: 'One guide is already being worked on. Wait for it to finish.' }, { status: 429 });
    }
    const burst = checkRateLimit(`guide-improve:${user.id}`, BURST_LIMIT, BURST_WINDOW_MS);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: `That is ${BURST_LIMIT} in a few minutes. Try again in ${Math.ceil(burst.retryAfterSec / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(burst.retryAfterSec) } },
      );
    }
    // Counted together with the writer's calls: both spend from the same pocket,
    // so a per-feature ceiling would be no ceiling at all.
    const spentToday = countAuditToday('guide.generate', user.id) + countAuditToday(AUDIT_ACTION, user.id);
    if (spentToday >= DAILY_LIMIT_PER_USER) {
      return NextResponse.json({ error: `That is ${DAILY_LIMIT_PER_USER} today. The limit resets tomorrow.` }, { status: 429 });
    }
    const spentAll = countAuditToday('guide.generate') + countAuditToday(AUDIT_ACTION);
    if (spentAll >= DAILY_LIMIT_TOTAL) {
      return NextResponse.json({ error: 'The daily limit has been reached across the business.' }, { status: 429 });
    }

    // Read the guide's own photos server-side. The browser already showed them;
    // making it upload them back would double the traffic for nothing.
    const steps: ExistingStep[] = [];
    let photos = 0;
    for (let i = 0; i < guide.steps.length; i++) {
      const s = guide.steps[i];
      const step: ExistingStep = {
        number: i + 1,
        text: richTextToPlain(s.explanation || ''),
        mediaType: s.media_type,
      };
      if (s.media_type === 'photo' && s.has_image && photos < MAX_PHOTOS) {
        const media = await getStepMedia('guide', s.id, allowed, id);
        if (media?.data_base64) {
          step.photo = { base64: media.data_base64, mediaType: media.mimetype || 'image/jpeg' };
          photos++;
        }
      }
      steps.push(step);
    }

    inFlight.add(user.id);
    let result;
    try {
      result = await improveGuide(steps, notes);
    } finally {
      inFlight.delete(user.id);
    }

    if (!result.ok) {
      audit(user, {
        guide_id: id, steps: steps.length, photos, outcome: result.failure,
        usage: (result as { usage?: GuideWriterUsage }).usage ?? null,
      });
      const status = result.failure === 'not-configured' ? 503 : 502;
      return NextResponse.json(
        { error: FAILURE_MESSAGE[result.failure] ?? FAILURE_MESSAGE.error, failure: result.failure },
        { status },
      );
    }

    audit(user, {
      guide_id: id, steps: steps.length, photos, outcome: 'ok',
      proposals: result.result.proposals.length,
      skipped: result.result.skipped.length,
      model: result.model, prompt_version: result.promptVersion, usage: result.usage,
    });

    return NextResponse.json({ ok: true, ...result.result, usage: result.usage });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[ai] POST guide improve error:', err);
    return NextResponse.json({ error: 'Could not work on the guide.' }, { status: 500 });
  }
}
