'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import PinnableImage from '@/components/ui/PinnableImage';
import { useTopBar } from '@/components/ui/TopBarContext';
import { youtubeEmbedUrl, youtubeWatchUrl } from '@/lib/youtube-url';
import type { StaffGuide, StaffGuideStep, TemplateGuide, LibraryGuide } from '@/lib/task-guide';

/**
 * GuidedTutorialPlayer — STAFF full-screen player for a task's guided tutorial.
 *
 * PURELY INSTRUCTIONAL. It pages through a published guide's ordered steps so
 * staff can learn *how* to do a task. It NEVER completes the task, ticks a
 * subtask, or calls any completion endpoint — staff still tick the task with the
 * normal control on the row. The last step's forward action simply closes.
 *
 * Mirrors SetupGuideView's PinnableImage usage and card styling, but drops all
 * of its check-off / auto-completion behaviour (that coupling is the thing the
 * guided-tutorials migration removes — see
 * docs/superpowers/specs/2026-07-28-guided-tutorials-design.md).
 *
 * Data (same-origin JSON, read-only):
 *   Staff (default):
 *     GET /api/tasks/lines/{lineId}/guide                       -> StaffGuide
 *     GET /api/tasks/lines/{lineId}/guide/steps/{stepId}/media  -> raw photo/pdf bytes
 *   Manager library preview (kind 'library-manager' — read-only):
 *     GET /api/tasks/guides/{guideId}                       -> LibraryGuide
 *     GET /api/tasks/guides/{guideId}/steps/{stepId}/media  -> raw bytes
 *   Staff Training (kind 'training' — read-only, no task):
 *     GET /api/tasks/training/guides/{guideId}                       -> {name,steps}
 *     GET /api/tasks/training/guides/{guideId}/steps/{stepId}/media  -> raw bytes
 */

/** Where the player reads its guide from. 'daily' is a real task's frozen
 * snapshot (the only mode that sits next to a tickable task); the other two are
 * read-only previews of a reusable library guide. */
export type PlayerSource =
  | { kind: 'daily'; lineId: number }
  | { kind: 'library-manager'; guideId: number }
  | { kind: 'training'; guideId: number };

interface Props {
  source: PlayerSource;
  onClose: () => void;
}

function guideEndpoint(s: PlayerSource): string {
  if (s.kind === 'daily') return `/api/tasks/lines/${s.lineId}/guide`;
  if (s.kind === 'library-manager') return `/api/tasks/guides/${s.guideId}`;
  return `/api/tasks/training/guides/${s.guideId}`;
}

function mediaEndpoint(s: PlayerSource, sid: number): string {
  if (s.kind === 'daily') return `/api/tasks/lines/${s.lineId}/guide/steps/${sid}/media`;
  if (s.kind === 'library-manager') return `/api/tasks/guides/${s.guideId}/steps/${sid}/media`;
  return `/api/tasks/training/guides/${s.guideId}/steps/${sid}/media`;
}

/** Normalize a library/training payload ({name, steps:[GuideStepRead-ish]}) into
 * the StaffGuide shape the player renders. */
function normalizeLibrary(data: { name?: string; steps: TemplateGuide['steps'] }): StaffGuide {
  return {
    line_name: data.name || '',
    steps: data.steps.map(s => ({
      id: s.id,
      media_type: s.media_type,
      explanation: s.explanation,
      has_image: s.has_image,
      has_pdf: s.has_pdf,
      pdf_filename: s.pdf_filename,
      youtube_url: s.youtube_url,
      pins: s.pins.map(p => ({ pin_x: p.pin_x, pin_y: p.pin_y, note: p.note })),
    })),
  };
}

/** Focusable descendants, in DOM order, used to trap Tab inside the dialog. */
function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const sel =
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    el => el.offsetParent !== null || el === document.activeElement,
  );
}

export default function GuidedTutorialPlayer({ source, onClose }: Props) {
  const isPreview = source.kind !== 'daily';
  const endpoint = guideEndpoint(source);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState<StaffGuide | null>(null);
  const [index, setIndex] = useState(0);
  // Pin whose note is shown in the bottom sheet (photo steps only), else null.
  const [activePin, setActivePin] = useState<number | null>(null);
  // Steps whose photo failed to load — show explanation + placeholder instead.
  const [imgError, setImgError] = useState<Set<number>>(new Set());
  // Bumped by a "Try again" tap to re-run the guide fetch.
  const [reloadTick, setReloadTick] = useState(0);

  // Hide the portal's global top bar while the full-screen player is open so the
  // stray date/company chrome doesn't peek above it. Capture the bar's state at
  // mount and RESTORE it on unmount (not force "shown") — the manager editor's
  // preview opens this player while the editor itself has already hidden the bar,
  // so a blind setHidden(false) would flash the global bar back while the editor
  // stays open. In the plain staff case the prior state is "shown", so this still
  // restores to shown exactly as before.
  const { hidden, setHidden } = useTopBar();
  useEffect(() => {
    const prevHidden = hidden;
    setHidden(true);
    return () => setHidden(prevHidden);
    // Mount-only: capture the bar state once; re-running on `hidden` changes
    // would clobber the captured baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHidden]);

  const containerRef = useRef<HTMLDivElement>(null);
  const pinSheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep live values for the mount-only key handler without re-binding it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const activePinRef = useRef(activePin);
  activePinRef.current = activePin;

  const steps = guide?.steps ?? [];
  const total = steps.length;
  const step: StaffGuideStep | undefined = steps[index];
  const isLast = index >= total - 1;

  const mediaSrc = useCallback(
    (sid: number) => mediaEndpoint(source, sid),
    [source],
  );

  // Load the guide from whichever source is set. Re-runs on source change and on
  // a "Try again" tap (reloadTick). daily → StaffGuide as-is; the two library
  // sources → LibraryGuide/{name,steps} normalized into the StaffGuide shape.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGuide(null);
    setIndex(0);
    setActivePin(null);
    setImgError(new Set());

    fetch(endpoint, { headers: { Accept: 'application/json' } })
      .then(async res => {
        if (!res.ok) throw new Error('guide-load-failed');
        const json = await res.json();
        return source.kind === 'daily'
          ? (json as StaffGuide)
          : normalizeLibrary(json as LibraryGuide);
      })
      .then(data => {
        if (cancelled) return;
        setGuide(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn('[tasks] guided tutorial load failed', e);
        setError('load-failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, source.kind, reloadTick]);

  // Any pin note belongs to the step it was opened on — close it on navigation.
  // Also clear the step we're landing on from imgError, so a photo that failed
  // earlier gets a fresh load attempt when the user comes back to it.
  useEffect(() => {
    setActivePin(null);
    const sid = guide?.steps[index]?.id;
    if (sid === undefined) return;
    setImgError(prev => {
      if (!prev.has(sid)) return prev;
      const next = new Set(prev);
      next.delete(sid);
      return next;
    });
  }, [index, guide]);

  // "Try again" on a broken photo — drop it from imgError so it reloads.
  const retryImage = useCallback((sid: number) => {
    setImgError(prev => {
      if (!prev.has(sid)) return prev;
      const next = new Set(prev);
      next.delete(sid);
      return next;
    });
  }, []);

  // Focus management + trap (mount once). Move focus into the dialog, keep Tab
  // cycling inside it, close on Esc (a pin sheet first, then the player), and
  // restore focus to the opener (the row's "Show me how" button) on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activePinRef.current !== null) setActivePin(null);
        else onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // While a pin note is open it's a modal-within-modal: trap Tab inside the
      // sheet, not the whole player.
      const root =
        activePinRef.current !== null && pinSheetRef.current
          ? pinSheetRef.current
          : containerRef.current;
      if (!root) return;
      const nodes = focusableWithin(root);
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === root || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteOpen = step?.media_type === 'photo' && activePin !== null && !!step.pins[activePin];

  // Move focus into the pin-note sheet when it opens and return it to the pin
  // (if still on screen) when it closes — the sheet is a modal within the player.
  useEffect(() => {
    if (!noteOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    (focusableWithin(pinSheetRef.current)[0] ?? pinSheetRef.current)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [noteOpen]);

  function goBack() {
    setIndex(i => Math.max(0, i - 1));
  }
  function goNext() {
    if (isLast) onClose();
    else setIndex(i => Math.min(total - 1, i + 1));
  }

  const activeNote =
    step && step.media_type === 'photo' && activePin !== null ? step.pins[activePin]?.note : undefined;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex flex-col bg-gray-50 outline-none"
    >
      {/* Header (blue portal chrome) */}
      <header className="flex-shrink-0 bg-[#2563EB] text-white px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">
              How-to guide
            </p>
            <h1 id={titleId} className="text-lg font-bold leading-tight truncate">
              {guide?.line_name || (isPreview ? 'Guide preview' : 'Guided tutorial')}
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="flex-shrink-0 -mr-1 w-10 h-10 flex items-center justify-center rounded-full text-white/90 active:bg-white/15 motion-safe:transition-colors"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              &#x2715;
            </span>
          </button>
        </div>

        {total > 0 && (
          <>
            <p className="mt-2 text-sm font-semibold text-white/90" aria-live="polite">
              Step {index + 1} of {total}
            </p>
            <div
              className="mt-1.5 flex flex-wrap items-center gap-0.5"
              role="group"
              aria-label={`Step navigation — step ${index + 1} of ${total}`}
            >
              {steps.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Go to step ${i + 1} of ${total}`}
                  aria-current={i === index ? 'true' : undefined}
                  // Small visual bar inside a padded (~28px) touch target.
                  className="group flex items-center justify-center h-7 px-1"
                >
                  <span
                    className={`block h-1.5 rounded-full motion-safe:transition-all ${
                      i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40 group-active:bg-white/80'
                    }`}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto">
          {loading && (
            <div className="py-16 text-center text-sm font-medium text-gray-500">Loading how-to…</div>
          )}

          {!loading && error && (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2" aria-hidden="true">
                &#x26A0;&#xFE0F;
              </div>
              <p className="text-sm font-semibold text-gray-700">
                Couldn&rsquo;t load the how-to. Check your connection and try again.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setReloadTick(t => t + 1)}
                  className="px-4 py-2 rounded-lg bg-[#16A34A] text-white text-sm font-semibold active:bg-[#15803D]"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold active:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!loading && !error && total === 0 && (
            <div className="py-16 text-center">
              <div className="text-3xl mb-2" aria-hidden="true">
                &#x1F4D6;
              </div>
              <p className="text-sm font-semibold text-gray-700">No how-to yet</p>
              <p className="mt-1 text-xs text-gray-500">There are no steps to show for this task.</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold active:bg-gray-200"
              >
                Close
              </button>
            </div>
          )}

          {!loading && !error && step && (
            // key remounts the media (unmounts any YouTube iframe, resets <img>)
            // whenever the active step changes.
            <div key={step.id} className="space-y-3">
              <StepMedia
                step={step}
                src={mediaSrc(step.id)}
                broken={imgError.has(step.id)}
                activePin={activePin}
                onPinClick={i => setActivePin(a => (a === i ? null : i))}
                onImageError={() => setImgError(prev => new Set(prev).add(step.id))}
                onRetry={() => retryImage(step.id)}
                lineName={guide?.line_name || ''}
                stepNo={index + 1}
              />

              {/* Pins aren't obviously tappable on their own — tell staff to tap
                  them (and pulse the markers, below, to draw the eye). */}
              {step.media_type === 'photo' && step.pins.length > 0 && !imgError.has(step.id) && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center" aria-hidden="true">1</span>
                  <p className="text-[13px] font-semibold text-orange-800">
                    Tap each numbered marker on the photo to read its note
                    {step.pins.length > 1 ? ` (${step.pins.length} of them)` : ''}.
                  </p>
                </div>
              )}

              {/* Explanation, always as TEXT (never HTML). Tip steps render the
                  explanation inside their own panel, so don't repeat it here. */}
              {step.media_type !== 'tip' && step.explanation.trim() && (
                <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {step.explanation}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer nav */}
      {!loading && !error && total > 0 && (
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-md mx-auto">
            {/* Persistent reminder — the guide is instructional only; staff still
                tick the task off themselves. Hidden in any preview (no task). */}
            {!isPreview && (
              <p className="mb-2 text-center text-xs font-medium text-gray-500">
                This just shows you how — you still tick the task off yourself.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={index === 0}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 active:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none motion-safe:transition-colors"
              >
                &#x2190; Back
              </button>
              <button
                type="button"
                onClick={goNext}
                className={`flex-[1.4] py-3 rounded-xl text-sm font-semibold motion-safe:transition-colors ${
                  isLast
                    ? 'border border-gray-300 bg-white text-gray-700 active:bg-gray-100'
                    : 'bg-[#16A34A] text-white active:bg-[#15803D]'
                }`}
              >
                {isLast ? 'Got it' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin note — bottom sheet, above the player (z-[110]) */}
      {activeNote !== undefined && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center"
          onClick={() => setActivePin(null)}
        >
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
          <div
            ref={pinSheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`Note ${(activePin ?? 0) + 1}`}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl sm:mb-6 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 flex-shrink-0 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center">
                  {(activePin ?? 0) + 1}
                </span>
                <span className="text-sm font-bold text-gray-800">Note</span>
              </div>
              <button
                type="button"
                onClick={() => setActivePin(null)}
                aria-label="Close note"
                className="w-9 h-9 flex items-center justify-center text-gray-400 active:text-gray-600"
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  &#x2715;
                </span>
              </button>
            </div>
            <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{activeNote}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders one step's media area by type. Photo pins reuse PinnableImage. */
function StepMedia({
  step,
  src,
  broken,
  activePin,
  onPinClick,
  onImageError,
  onRetry,
  lineName,
  stepNo,
}: {
  step: StaffGuideStep;
  src: string;
  broken: boolean;
  activePin: number | null;
  onPinClick: (index: number) => void;
  onImageError: () => void;
  onRetry: () => void;
  lineName: string;
  stepNo: number;
}) {
  if (step.media_type === 'tip') {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-lg" aria-hidden="true">
            &#x26A0;&#xFE0F;
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-700">
            Tip
          </span>
        </div>
        <p className="text-sm leading-relaxed text-amber-900 whitespace-pre-wrap">
          {step.explanation.trim() || 'Keep this in mind for this step.'}
        </p>
      </div>
    );
  }

  if (step.media_type === 'youtube') {
    const embed = youtubeEmbedUrl(step.youtube_url);
    const watch = youtubeWatchUrl(step.youtube_url);
    if (!embed) {
      return (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <div className="text-2xl mb-1" aria-hidden="true">
            &#x1F4F9;
          </div>
          <p className="text-sm font-medium text-gray-600">
            Video couldn&rsquo;t load — follow the written steps below; you can still finish the task.
          </p>
        </div>
      );
    }
    return (
      <div>
        <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '16 / 9' }}>
          <iframe
            src={embed}
            title={`Video for step ${stepNo}${lineName ? ` — ${lineName}` : ''}`}
            className="absolute inset-0 w-full h-full"
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        {watch && (
          <a
            href={watch}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#16A34A] active:text-[#15803D]"
          >
            Open in YouTube &#x2197;
          </a>
        )}
      </div>
    );
  }

  if (step.media_type === 'pdf') {
    if (!step.has_pdf) {
      return (
        <div className="rounded-2xl border border-gray-200 bg-gray-100 p-6 text-center">
          <div className="text-2xl mb-1" aria-hidden="true">
            &#x1F4C4;
          </div>
          <p className="text-sm font-medium text-gray-600">
            PDF couldn&rsquo;t load — follow the written steps below; you can still finish the task.
          </p>
        </div>
      );
    }
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-50 motion-safe:transition-colors"
      >
        <span className="flex-shrink-0 w-11 h-11 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-xl" aria-hidden="true">
          &#x1F4C4;
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-800 truncate">
            {step.pdf_filename || 'Document.pdf'}
          </span>
          <span className="block text-xs font-semibold text-[#16A34A]">Open PDF &#x2197;</span>
        </span>
      </a>
    );
  }

  // photo
  if (!step.has_image || broken) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-100 p-6 text-center">
        <div className="text-2xl mb-1" aria-hidden="true">
          &#x1F5BC;&#xFE0F;
        </div>
        <p className="text-sm font-medium text-gray-600">
          Photo couldn&rsquo;t load — follow the written steps below; you can still finish the task.
        </p>
        {broken && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 active:bg-gray-100"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-center rounded-2xl bg-gray-100 p-1.5">
      <PinnableImage
        src={src}
        alt={`Step ${stepNo} photo`}
        mode="view"
        pins={step.pins.map((p, i) => ({
          pin_x: p.pin_x,
          pin_y: p.pin_y,
          label: p.note,
          number: i + 1,
        }))}
        activeIndex={activePin}
        onPinClick={onPinClick}
        onImageError={onImageError}
      />
    </div>
  );
}
