import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { moduleForbidden } from '@/lib/module-access';
import { writeGuide, MAX_PHOTOS, MAX_BULLETS, type GuidePhotoInput, type GuideWriterUsage } from '@/lib/ai/guide-writer';
import { logAudit, countAuditToday } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST — write a draft guide from photos and notes. Returns it; saves NOTHING.
 *
 * The separation is the whole safety story. This endpoint cannot create,
 * modify or publish a guide; the manager reads what comes back and, if they
 * want it, saves it through the ordinary guide editor. There is no path where
 * AI-written text reaches a cook without a person having read it.
 *
 * Costs the owner money per call, so: managers only, one at a time, bounded
 * input, and every call is written to the audit log with who asked and what it
 * spent.
 */
export const dynamic = 'force-dynamic';

/** Base64 characters per photo. The browser compresses to ~1280px/0.85 (a few
 *  hundred KB); this is the ceiling that says "that did not come from our
 *  uploader" rather than a limit anyone meets honestly. */
const MAX_PHOTO_B64 = 6_000_000;
const MAX_TITLE = 200;

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

const AUDIT_ACTION = 'guide.generate';
/** Bursts, per manager. Writing three guides back to back is real work; thirty
 *  in ten minutes is a loop. */
const BURST_LIMIT = 5;
const BURST_WINDOW_MS = 10 * 60 * 1000;
/** The ceiling that actually protects the bill. Counted from the audit log
 *  rather than memory, because the in-process limiter resets on every deploy
 *  and this portal deploys several times an hour. */
const DAILY_LIMIT_PER_USER = 40;
const DAILY_LIMIT_TOTAL = 150;

/** One generation at a time per person. The screen already disables its button;
 *  this is the same rule where it cannot be bypassed by a second tab or curl. */
const inFlight = new Set<number>();

/** Bill first, ask questions later is not an option: a refusal and a truncated
 *  reply both cost money, so every outcome that reached the API is recorded. */
function audit(user: { id: number; name: string }, detail: Record<string, unknown>) {
  try {
    logAudit({ user_id: user.id, user_name: user.name, action: AUDIT_ACTION, module: 'tasks', detail: JSON.stringify(detail) });
  } catch (e) {
    console.error('[ai] audit log failed for guide generation:', e);
  }
}

/** Plain English for each way this can fail. A manager should never see
 *  "bad-output" — they should be told whether to try again, fix something, or
 *  fetch someone. */
const FAILURE_MESSAGE: Record<string, string> = {
  'not-configured': 'The AI writer is not switched on for this server yet.',
  refused: 'The assistant would not write this one. Check the photos and notes, or write it by hand.',
  'too-long': 'That came out longer than there was room for. Try it with fewer photos.',
  'bad-output': 'The reply came back unusable. Try again — if it happens twice, the photos may be unclear.',
  error: 'Could not reach the assistant. Check your connection and try again.',
};

export async function POST(req: NextRequest) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireRole('manager');
    const body = await req.json();

    const title = String(body?.title ?? '').trim().slice(0, MAX_TITLE);
    if (!title) return NextResponse.json({ error: 'Give the guide a title first.' }, { status: 400 });

    const bullets = String(body?.bullets ?? '').slice(0, MAX_BULLETS);
    if (!bullets.trim()) {
      // Photos alone leave the model guessing at intent, and guessing is exactly
      // what must not happen in a kitchen instruction.
      return NextResponse.json(
        { error: 'Add a few notes — even rough ones. The photos alone do not say what matters.' },
        { status: 400 },
      );
    }

    const rawPhotos = Array.isArray(body?.photos) ? body.photos : [];
    if (!rawPhotos.length) {
      return NextResponse.json({ error: 'Add at least one photo.' }, { status: 400 });
    }
    if (rawPhotos.length > MAX_PHOTOS) {
      return NextResponse.json(
        { error: `That is more than ${MAX_PHOTOS} photos. Split it into two guides.` },
        { status: 400 },
      );
    }

    const photos: GuidePhotoInput[] = [];
    for (const p of rawPhotos) {
      const base64 = typeof p?.base64 === 'string' ? p.base64 : '';
      const mediaType = typeof p?.media_type === 'string' ? p.media_type : '';
      if (!base64 || !ALLOWED_MEDIA.has(mediaType)) {
        return NextResponse.json({ error: 'Photos must be JPEG, PNG or WebP.' }, { status: 400 });
      }
      if (base64.length > MAX_PHOTO_B64) {
        return NextResponse.json({ error: 'One of those photos is too large.' }, { status: 413 });
      }
      photos.push({ base64, mediaType });
    }

    // ── Everything below here can spend money. Guard it. ──────────────────
    if (inFlight.has(user.id)) {
      return NextResponse.json(
        { error: 'One guide is already being written. Wait for it to finish.' },
        { status: 429 },
      );
    }
    const burst = checkRateLimit(`guide-generate:${user.id}`, BURST_LIMIT, BURST_WINDOW_MS);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: `That is ${BURST_LIMIT} guides in a few minutes. Try again in ${Math.ceil(burst.retryAfterSec / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(burst.retryAfterSec) } },
      );
    }
    if (countAuditToday(AUDIT_ACTION, user.id) >= DAILY_LIMIT_PER_USER) {
      return NextResponse.json(
        { error: `That is ${DAILY_LIMIT_PER_USER} guides written today. The limit resets tomorrow.` },
        { status: 429 },
      );
    }
    if (countAuditToday(AUDIT_ACTION) >= DAILY_LIMIT_TOTAL) {
      return NextResponse.json(
        { error: 'The daily limit for writing guides has been reached across the business.' },
        { status: 429 },
      );
    }

    inFlight.add(user.id);
    let result;
    try {
      result = await writeGuide({ title, bullets, photos });
    } finally {
      inFlight.delete(user.id);
    }

    if (!result.ok) {
      // Audited even though it failed: a refusal and a truncated reply both
      // reached the API and both cost money. An unrecorded cost is a line on an
      // invoice nobody can explain.
      audit(user, {
        title, photos: photos.length, outcome: result.failure,
        usage: (result as { usage?: GuideWriterUsage }).usage ?? null,
      });
      // 503 for "the server is not set up" so it reads as an operator problem,
      // not something the manager typed wrong.
      const status = result.failure === 'not-configured' ? 503 : 502;
      return NextResponse.json(
        { error: FAILURE_MESSAGE[result.failure] ?? FAILURE_MESSAGE.error, failure: result.failure },
        { status },
      );
    }

    audit(user, {
      title,
      photos: photos.length,
      outcome: 'ok',
      steps: result.guide.steps.length,
      questions: result.guide.questions.length,
      model: result.model,
      prompt_version: result.promptVersion,
      usage: result.usage,
    });

    return NextResponse.json({
      ok: true,
      guide: result.guide,
      model: result.model,
      usage: result.usage,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[ai] POST guides/generate error:', err);
    return NextResponse.json({ error: 'Could not write the guide.' }, { status: 500 });
  }
}
