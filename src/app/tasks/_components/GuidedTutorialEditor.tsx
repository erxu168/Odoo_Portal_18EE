'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import DropZone from '@/components/ui/DropZone';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PinnableImage from '@/components/ui/PinnableImage';
import GuidedTutorialPlayer from './GuidedTutorialPlayer';
import { useTopBar } from '@/components/ui/TopBarContext';
import { isValidYoutubeUrl, canonicalYoutubeUrl } from '@/lib/youtube-url';
import {
  parseDrawings,
  serializeDrawings,
  DRAWING_COLORS,
  DRAWING_WIDTH_LEVELS,
  DEFAULT_DRAWING_WIDTH,
  clampDrawingWidth,
  drawingWidthPx,
  MAX_DRAWINGS,
  type GuideDrawing,
  type GuideDrawingType,
} from '@/lib/guide-drawings';
import type { GuideStepRead, GuideStepSave, GuidePin, GuideMediaType } from '@/lib/task-guide';
import { compressImage } from './photoUpload';
import PhotoSourceSheet from '@/components/ui/PhotoSourceSheet';
import { useConfirm } from '@/components/ui/useConfirm';

/*
 * GuidedTutorialEditor — manager/admin editor for a REUSABLE library guide
 * (krawings.task.guide): an ordered list of how-to steps + the guide's name. It
 * is PURELY INSTRUCTIONAL — nothing here ever completes a task. Editing a guide
 * updates it everywhere it is linked (edit-once-updates-everywhere); each daily
 * task keeps the frozen snapshot it took at spawn. Owns its own load/save/delete.
 *
 * Server contract (krawings.task.guide.portal_save_guide via
 * /api/tasks/guides/{guideId}): a save is an ATOMIC AGGREGATE REBUILD — the
 * server unlinks every existing step and recreates them fresh, so ALL local step
 * ids go stale the instant a save succeeds. A step whose photo/pdf is unchanged
 * sends its `id` and NO *_base64, and the server carries the prior bytes over by
 * that id. Therefore, after a successful save we MUST re-GET the guide so local
 * steps pick up their new ids (and drop the pending base64 the server now owns) —
 * otherwise a second save would reference deleted ids and lose the "kept" photos.
 * Optimistic concurrency: PUT sends the current `revision`; a stale editor gets
 * 409 and must reload.
 */

interface Props {
  guideId: number;
  /** Name shown until the GET lands (e.g. from the library list row). */
  guideName: string;
  onClose: () => void;
  /** Called after any save/delete so the Library list can refresh. */
  onSaved?: () => void;
  /** Called after the guide is DELETED (the record is gone — close the editor). */
  onDeleted?: () => void;
}

/** One step as the editor works with it: a stable local `key` (used for React
 * keys AND dnd-kit ids — server ids are unstable across saves), the server `id`
 * when it exists, and per-media working fields. */
interface EditorStep {
  /** Stable within this editor session; regenerated on every (re)load. */
  key: string;
  /** Server id — present for a loaded step, absent for one added this session.
   * Goes STALE after any successful save (aggregate rebuild), hence the re-GET. */
  id?: number;
  media_type: GuideMediaType;
  explanation: string;
  // photo
  pins: GuidePin[];
  /** Author-drawn marks over the photo (arrow/circle/box/pen), fractions 0..1. */
  drawings: GuideDrawing[];
  /** Base64 (NO data: prefix) for a NEW/replaced photo — sent as image_base64. */
  photoBase64?: string;
  photoFilename?: string;
  /** Display src: media-route URL for kept bytes, or a local data: URL when pending. */
  photoUrl?: string;
  /** True when the server holds bytes AND no replacement is pending (⇒ send no base64). */
  hasExistingPhoto?: boolean;
  // pdf
  pdfBase64?: string;
  pdfFilename?: string;
  pdfUrl?: string;
  hasExistingPdf?: boolean;
  /** Byte size of a NEWLY attached PDF (shown next to its filename). */
  pdfSize?: number;
  // youtube
  youtube_url?: string;
}

const STEP_TYPES: { type: GuideMediaType; emoji: string; label: string; hint: string }[] = [
  { type: 'photo',   emoji: '📷', label: 'Photo', hint: 'Picture with optional note-pins' },
  { type: 'youtube', emoji: '🎬', label: 'Video', hint: 'A YouTube link' },
  { type: 'tip',     emoji: '⚠️', label: 'Tip',   hint: 'A short warning or reminder' },
  { type: 'pdf',     emoji: '📄', label: 'PDF',   hint: 'A document to open' },
];

const TYPE_META: Record<GuideMediaType, { emoji: string; label: string }> =
  Object.fromEntries(STEP_TYPES.map(t => [t.type, { emoji: t.emoji, label: t.label }])) as Record<GuideMediaType, { emoji: string; label: string }>;

/** Sane upper bounds enforced even on a Draft save (not full per-step validity).
 * Kept in parity with the server (GUIDE_MAX_STEPS / GUIDE_MAX_PINS in
 * task_template_line.py) so the client never green-lights what the server rejects. */
const MAX_STEPS = 40;
const MAX_PINS = 20;
/** Server rejects PDFs above ~15 MB — reject early with a plain message. */
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function hasPhoto(s: EditorStep): boolean {
  return !!(s.photoBase64 || s.hasExistingPhoto);
}
function hasPdf(s: EditorStep): boolean {
  return !!(s.pdfBase64 || s.hasExistingPdf);
}

/** Human-readable file size for the attached-PDF row. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Focusable descendants, in DOM order, used to trap Tab inside the dialog.
 * Mirrors GuidedTutorialPlayer's helper, but uses the `:disabled` pseudo-class
 * (not the `[disabled]` attribute) so controls disabled indirectly by the
 * save-time `<fieldset disabled>` are correctly treated as NOT focusable. */
function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const sel =
    'a[href],button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),iframe,[tabindex]:not([tabindex="-1"]):not(:disabled)';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    el => el.offsetParent !== null || el === document.activeElement,
  );
}

export default function GuidedTutorialEditor({ guideId, guideName, onClose, onSaved, onDeleted }: Props) {
  const guideBase = `/api/tasks/guides/${guideId}`;
  const mediaHref = useCallback(
    (stepId: number) => `${guideBase}/steps/${stepId}/media`,
    [guideBase],
  );

  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [name, setName] = useState(guideName);
  const [usedCount, setUsedCount] = useState(0);
  const [published, setPublished] = useState(false);
  const [revision, setRevision] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Staff-player preview of the SAVED guide (opens over the editor). */
  const [previewOpen, setPreviewOpen] = useState(false);
  const { confirm, confirmElement } = useConfirm();

  // Hide the global top bar while this full-height editor is open.
  const { setHidden } = useTopBar();
  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, [setHidden]);

  /** The pin whose note is being edited, scoped by step key so numbering/focus
   * never leak between steps. */
  const [activePin, setActivePin] = useState<{ key: string; index: number } | null>(null);
  /** Steps whose photo/pdf byte-processing is in flight — their controls freeze
   * so a pin can't be added between the replace-confirm and the atomic swap. */
  const [busySteps, setBusySteps] = useState<Set<string>>(new Set());
  /** Existing steps whose stored media failed to load (corrupt bytes). */
  const [imgError, setImgError] = useState<Set<string>>(new Set());

  // ── Synchronous mirrors (refs) so async callbacks read CURRENT values ────────
  // React state is snapshotted when a callback is created; a compression or fetch
  // that resolves later must consult the ref, not the stale captured value.
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  /** The dialog container — focused on open, traps Tab, restores opener on close. */
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Live mirror so the mount-only key handlers can bail while preview is open
   * (the preview player owns focus + Escape while it is up). */
  const previewOpenRef = useRef(false);
  previewOpenRef.current = previewOpen;
  /** Count of in-flight media (compress/FileReader) ops. Save refuses to start
   * while > 0, closing the same-tick race where a file was picked but Save still
   * saw the old React state. */
  const pendingMediaRef = useRef(0);
  /** Per-step "latest media op" token: a slow first pick must not overwrite a
   * later replacement. Only the newest token for a key may write. */
  const mediaTokens = useRef<Map<string, number>>(new Map());
  const keySeq = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const nextKey = () => `k${keySeq.current++}`;

  const hydrate = useCallback((r: GuideStepRead): EditorStep => {
    const media = mediaHref(r.id);
    return {
      key: `k${keySeq.current++}`,
      id: r.id,
      media_type: r.media_type,
      explanation: r.explanation || '',
      pins: r.media_type === 'photo'
        ? (r.pins || []).map(p => ({ id: p.id, pin_x: p.pin_x, pin_y: p.pin_y, note: p.note || '' }))
        : [],
      drawings: r.media_type === 'photo' ? parseDrawings(r.drawings) : [],
      photoFilename: r.image_filename || undefined,
      photoUrl: r.has_image ? media : undefined,
      hasExistingPhoto: !!r.has_image,
      pdfFilename: r.pdf_filename || undefined,
      pdfUrl: r.has_pdf ? media : undefined,
      hasExistingPdf: !!r.has_pdf,
      youtube_url: r.youtube_url || '',
    };
  }, [mediaHref]);

  /** Returns true when the guide was re-read successfully. Callers that MUST have
   * fresh step ids (the post-save re-hydrate) use this to decide what to show. */
  const load = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!opts?.silent) setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(guideBase, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Could not load the guide (${res.status})`);
      if (!mountedRef.current) return false;
      const raw: GuideStepRead[] = Array.isArray(body.steps) ? body.steps : [];
      setSteps(raw.map(hydrate));
      if (typeof body.name === 'string') setName(body.name);
      setUsedCount(Number(body.template_line_count) || 0);
      setPublished(!!body.published);
      setRevision(Number(body.revision) || 0);
      setStale(false);
      setDirty(false);
      setActivePin(null);
      setImgError(new Set());
      mediaTokens.current = new Map();
      return true;
    } catch (e: unknown) {
      if (!mountedRef.current) return false;
      if (!opts?.silent) {
        setLoadError(e instanceof Error ? e.message : 'Could not load the guide');
      } else {
        // The MANDATORY post-save re-GET failed: local step ids are now stale
        // (the server rebuilt the aggregate), so a follow-up save would reference
        // deleted ids and drop the kept photos/PDFs. Mark stale to DISABLE Save
        // until a successful reload — never let a second save run on stale ids.
        setStale(true);
        setError('Saved, but couldn’t reload the latest version. Reload before editing again so your photos aren’t lost.');
      }
      return false;
    } finally {
      if (mountedRef.current && !opts?.silent) setLoading(false);
    }
  }, [guideBase, hydrate]);

  useEffect(() => { load(); }, [load]);

  // Escape closes (unless a save or media op is in flight). Re-subscribe when the
  // values it reads change so the closure never goes stale. While the preview
  // player is up it owns Escape, so bail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (previewOpenRef.current) return;
      if (e.key === 'Escape') void requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  // Focus management + Tab trap (mount once). Move focus into the dialog, keep Tab
  // cycling inside it, and restore focus to the opener (the row's edit button) on
  // unmount. Escape is handled by the effect above. Mirrors GuidedTutorialPlayer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (previewOpenRef.current) return; // the preview player traps its own focus
      const root = dialogRef.current;
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

  // ── Mutation choke points (all refuse to write while frozen) ────────────────
  // Marking dirty also clears any lingering "Saved." notice, so success copy
  // never outlives the edit that invalidated it.
  const markDirty = useCallback(() => {
    if (savingRef.current) return;
    setDirty(true);
    setNotice(null);
  }, []);

  const patchStep = useCallback((key: string, patch: Partial<EditorStep>) => {
    if (savingRef.current) return;
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, ...patch } : s)));
    markDirty();
  }, [markDirty]);

  const setPins = useCallback((key: string, pins: GuidePin[]) => {
    if (savingRef.current) return;
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, pins } : s)));
    markDirty();
  }, [markDirty]);

  const setDrawings = useCallback((key: string, drawings: GuideDrawing[]) => {
    if (savingRef.current) return;
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, drawings } : s)));
    markDirty();
  }, [markDirty]);

  function addStep(type: GuideMediaType) {
    if (savingRef.current) return;
    setSteps(prev => [...prev, {
      key: nextKey(),
      media_type: type,
      explanation: '',
      pins: [],
      drawings: [],
      hasExistingPhoto: false,
      hasExistingPdf: false,
      youtube_url: '',
    }]);
    markDirty();
  }

  /** True when a step holds work worth confirming before it is thrown away. */
  function stepHasContent(s: EditorStep): boolean {
    return !!(hasPhoto(s) || hasPdf(s) || s.explanation.trim() ||
      (s.pins && s.pins.length > 0) || (s.drawings && s.drawings.length > 0) ||
      (s.youtube_url || '').trim());
  }

  async function removeStep(key: string) {
    if (savingRef.current) return;
    const idx = steps.findIndex(s => s.key === key);
    if (idx === -1) return;
    // Confirm only when there's something to lose — an empty just-added step goes
    // quietly. Mirrors the "Remove guide" confirm wording.
    if (stepHasContent(steps[idx]) && !await confirm({
      title: `Remove step ${idx + 1}?`,
      message: "Its photo and notes are deleted with it. This can't be undone.",
      confirmLabel: 'Remove step',
      variant: 'danger',
    })) return;
    // Re-check AFTER the dialog: the old browser confirm() froze the tab, so a
    // save could not begin while it was open. This one does not, so the guard
    // has to hold on both sides of the await.
    if (savingRef.current) return;
    setSteps(prev => prev.filter(s => s.key !== key));
    setActivePin(a => (a?.key === key ? null : a));
    markDirty();
  }

  // ── Async media processing with save/superseded/exists guards ───────────────
  function beginMedia(key: string): number {
    pendingMediaRef.current += 1;
    setBusySteps(prev => { const n = new Set(prev); n.add(key); return n; });
    const t = (mediaTokens.current.get(key) || 0) + 1;
    mediaTokens.current.set(key, t);
    return t;
  }
  function endMedia(key: string) {
    pendingMediaRef.current = Math.max(0, pendingMediaRef.current - 1);
    setBusySteps(prev => { const n = new Set(prev); n.delete(key); return n; });
  }
  /** Apply a media result IFF: still mounted, no save started, this is still the
   * newest op for the key, and the step still exists. `patch === null` means the
   * op failed (error already surfaced) — just release the busy state. */
  function applyMedia(key: string, token: number, patch: Partial<EditorStep> | null) {
    endMedia(key);
    if (!mountedRef.current || savingRef.current) return;
    if (mediaTokens.current.get(key) !== token) return; // a newer pick supersedes this one
    if (patch === null) return;
    setSteps(prev => (prev.some(s => s.key === key) ? prev.map(s => (s.key === key ? { ...s, ...patch } : s)) : prev));
    markDirty();
  }

  async function pickPhoto(key: string, file: File) {
    if (savingRef.current) return;
    const token = beginMedia(key);
    setActivePin(a => (a?.key === key ? null : a)); // pins are cleared on replace
    try {
      const { base64, filename } = await compressImage(file, 1280, 0.85);
      setImgError(prev => { const n = new Set(prev); n.delete(key); return n; });
      // Install the replacement AND clear pins + drawings atomically — both point
      // at the old photo's coordinates and would be wrong on the new one. Only
      // reached on a SUCCESSFUL compression, so a failed replace loses nothing.
      applyMedia(key, token, {
        photoBase64: base64,
        photoFilename: filename,
        photoUrl: `data:image/jpeg;base64,${base64}`,
        hasExistingPhoto: false,
        pins: [],
        drawings: [],
      });
    } catch (e: unknown) {
      applyMedia(key, token, null);
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Could not process that photo');
    }
  }

  function pickPdf(key: string, file: File) {
    if (savingRef.current) return;
    // Reject oversized files before reading them — matches the server's ~15 MB cap.
    if (file.size > MAX_PDF_BYTES) {
      const mb = Math.round(file.size / (1024 * 1024));
      setError(`That PDF is ${mb} MB — please use one under 15 MB.`);
      return;
    }
    const token = beginMedia(key);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1] || '';
      let ok = false;
      try { ok = atob(base64.slice(0, 8)).startsWith('%PDF'); } catch { ok = false; }
      if (!ok || !base64) {
        applyMedia(key, token, null);
        if (mountedRef.current) setError('That file does not look like a PDF.');
        return;
      }
      applyMedia(key, token, {
        pdfBase64: base64,
        pdfFilename: file.name || 'document.pdf',
        pdfUrl: undefined,
        hasExistingPdf: false,
        pdfSize: file.size,
      });
    };
    reader.onerror = () => {
      applyMedia(key, token, null);
      if (mountedRef.current) setError('Could not read that PDF.');
    };
    reader.readAsDataURL(file);
  }

  // ── Reorder (pointer + touch + keyboard). Numbering re-derives from order. ───
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = useCallback((e: DragEndEvent) => {
    // A drag begun before Save may still deliver its drop — discard it.
    if (savingRef.current) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSteps(prev => {
      const oldIndex = prev.findIndex(s => s.key === active.id);
      const newIndex = prev.findIndex(s => s.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    markDirty();
  }, [markDirty]);

  // ── Validation, save, delete ────────────────────────────────────────────────
  // A Draft only has to clear sane bounds (so a manager can save partial work and
  // come back). PUBLISHING additionally requires every step to be fully complete.
  function validate(forPublish: boolean): string | null {
    if (steps.length === 0) return 'Add at least one step, or use "Remove guide" to delete it.';
    if (steps.length > MAX_STEPS) return `Too many steps (max ${MAX_STEPS}). Remove some before saving.`;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const n = i + 1;
      // Bounds enforced for BOTH draft and publish.
      if (s.media_type === 'photo' && s.pins.length > MAX_PINS) {
        return `Step ${n}: too many note-pins (max ${MAX_PINS}).`;
      }
      // Full per-step content is required ONLY when publishing.
      if (!forPublish) continue;
      if (!s.explanation.trim()) return `Step ${n}: add an explanation.`;
      if (s.media_type === 'photo') {
        if (!hasPhoto(s)) return `Step ${n}: add a photo.`;
        if (s.pins.some(p => !p.note.trim())) return `Step ${n}: every note-pin needs a note.`;
      } else if (s.media_type === 'youtube') {
        if (!isValidYoutubeUrl(s.youtube_url || '')) return `Step ${n}: enter a valid YouTube link.`;
      } else if (s.media_type === 'pdf') {
        if (!hasPdf(s)) return `Step ${n}: attach a PDF.`;
      }
    }
    return null;
  }

  function buildSteps(): GuideStepSave[] {
    return steps.map(s => {
      const out: GuideStepSave = { media_type: s.media_type, explanation: s.explanation.trim() };
      if (s.id) out.id = s.id;
      if (s.media_type === 'photo') {
        out.pins = s.pins.map(p => {
          const pin: GuidePin = { pin_x: clamp01(p.pin_x), pin_y: clamp01(p.pin_y), note: p.note.trim() };
          if (p.id) pin.id = p.id;
          return pin;
        });
        // Drawings ride the step payload like pins (always sent, so clearing
        // them actually clears them server-side).
        out.drawings = serializeDrawings(s.drawings || []);
        // Send base64 ONLY for a new/replaced photo; a kept photo (id, no base64)
        // makes the server carry its prior bytes forward.
        if (s.photoBase64) { out.image_base64 = s.photoBase64; out.image_filename = s.photoFilename || 'photo.jpg'; }
      } else if (s.media_type === 'pdf') {
        if (s.pdfBase64) { out.pdf_base64 = s.pdfBase64; out.pdf_filename = s.pdfFilename || 'document.pdf'; }
      } else if (s.media_type === 'youtube') {
        out.youtube_url = canonicalYoutubeUrl(s.youtube_url) || (s.youtube_url || '').trim();
      }
      return out;
    });
  }

  async function handleSave() {
    if (savingRef.current) return;
    if (pendingMediaRef.current > 0) { setError('Wait for the photo or PDF to finish processing.'); return; }
    // Draft saves allow incomplete steps; publishing requires a complete guide.
    const v = validate(published);
    if (v) { setError(v); setNotice(null); return; }
    const cleanName = name.trim();
    if (!cleanName) { setError('Give this guide a name.'); setNotice(null); return; }

    setError(null); setNotice(null);
    savingRef.current = true; setSaving(true);
    // Snapshot the payload AFTER freezing, so no concurrent mutation can slip in.
    const payload = { revision, published, name: cleanName, steps: buildSteps() };
    try {
      const res = await fetch(guideBase, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Do NOT silently adopt the returned revision — ids/media may differ.
        if (mountedRef.current) {
          setStale(true);
          setError(body?.error || 'Someone else changed this guide. Reload the latest version, then redo your changes.');
        }
        return;
      }
      if (!res.ok || body?.ok === false) {
        if (mountedRef.current) setError(body?.error || `Could not save (${res.status}).`);
        return;
      }
      if (typeof body?.revision === 'number' && mountedRef.current) setRevision(body.revision);
      // Save = SAVE, not leave: keep the manager on the guide so they can carry
      // on adding steps/pins/drawings ("Close" is how you leave). The server
      // rebuilt the aggregate, so every local step id is now STALE — a follow-up
      // save on stale ids would drop the kept photos. The silent re-GET below is
      // therefore MANDATORY, and it fails closed (marks `stale`, disabling Save)
      // if it can't refresh.
      // Keep savingRef held through the re-hydrate (the `finally` clears it), so a
      // second Save can't start against ids the server just replaced.
      setDirty(false);
      onSaved?.();
      const fresh = await load({ silent: true });
      // On failure `load` already set a stale-warning error — don't overwrite it
      // with a cheerful "Saved."
      if (fresh && mountedRef.current) setNotice('Saved.');
      return;
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Could not save the guide.');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  async function handleDelete() {
    if (savingRef.current) return;
    if (usedCount > 0) {
      setError(`This guide is used by ${usedCount} task${usedCount === 1 ? '' : 's'}. Detach it from those tasks first, then delete it.`);
      return;
    }
    if (!await confirm({
      title: 'Delete this whole guide?',
      message: 'Every step is permanently removed. Tasks that already ran keep their own copy. This cannot be undone.',
      confirmLabel: 'Delete guide',
      variant: 'danger',
    })) return;
    setError(null); setNotice(null);
    savingRef.current = true; setSaving(true);
    try {
      const res = await fetch(guideBase, { method: 'DELETE', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        // 409 = the guide is still linked by a task — surface the server message.
        if (mountedRef.current) setError(body?.error || 'Could not delete the guide.');
        return;
      }
      onSaved?.();
      if (!mountedRef.current) return;
      setDirty(false);
      (onDeleted ?? onClose)();
    } catch (e: unknown) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Could not delete the guide.');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  async function requestClose() {
    if (savingRef.current || pendingMediaRef.current > 0) return;
    if (dirty && !await confirm({
      title: 'Discard your unsaved changes?',
      message: 'Anything you have edited since the last save is lost.',
      confirmLabel: 'Discard changes',
      variant: 'danger',
    })) return;
    onClose();
  }

  async function reloadStale() {
    if (savingRef.current) return;
    // Never auto-discard the manager's in-memory work — always confirm first.
    if (!await confirm({
      title: 'Reload and discard your changes?',
      message: 'Someone else saved this guide while you were editing. Reloading brings in their version and drops yours.',
      confirmLabel: 'Reload',
      variant: 'danger',
    })) return;
    load();
  }

  /**
   * Everything standing between this guide and Publish, listed live.
   *
   * validate() stops at the FIRST problem and only speaks when you press Save —
   * so flipping to Published looked fine, then Save refused with one line of
   * small red text and no clue that a second step had the same gap. This runs
   * as you type and names every step, so the switch tells you the truth before
   * you touch Save. It deliberately mirrors validate(true); validate stays the
   * single authority for whether a save proceeds.
   */
  const publishBlockers: string[] = [];
  {
    steps.forEach((s, i) => {
      const n = i + 1;
      if (!s.explanation.trim()) publishBlockers.push(`Step ${n} needs an explanation`);
      if (s.media_type === 'photo') {
        if (!hasPhoto(s)) publishBlockers.push(`Step ${n} needs a photo`);
        if (s.pins.some(p => !p.note.trim())) publishBlockers.push(`Step ${n} has a note-pin with no text`);
      } else if (s.media_type === 'youtube') {
        if (!isValidYoutubeUrl(s.youtube_url || '')) publishBlockers.push(`Step ${n} needs a valid YouTube link`);
      } else if (s.media_type === 'pdf') {
        if (!hasPdf(s)) publishBlockers.push(`Step ${n} needs a PDF`);
      }
    });
  }

  const frozen = saving;

  return (
    <>
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit guide ${name || guideName}`}
        className="bg-white w-full max-w-md sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] shadow-xl outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — portal blue */}
        <div className="bg-blue-600 text-white px-4 py-3 rounded-t-2xl flex items-start gap-3 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-blue-100">Guide</p>
            <h2 className="text-[var(--fs-base)] font-bold leading-tight truncate">{name || guideName}</h2>
            {usedCount > 0 && (
              <p className="text-[var(--fs-xs)] text-blue-100 leading-snug">
                Used by {usedCount} task{usedCount === 1 ? '' : 's'} — edits apply to all of them.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={frozen}
            aria-label="Close"
            className="w-11 h-11 -mr-1 flex-shrink-0 rounded-full flex items-center justify-center text-white/90 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
          {loading ? (
            <p className="text-[var(--fs-sm)] text-gray-500 py-8 text-center">Loading…</p>
          ) : loadError ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-[var(--fs-sm)] text-red-600 font-semibold">{loadError}</p>
              <button type="button" onClick={() => load()} className="text-[var(--fs-sm)] font-semibold text-green-700 hover:text-green-800">
                Try again
              </button>
            </div>
          ) : (
            <fieldset disabled={frozen} className="border-0 p-0 m-0 space-y-3 min-w-0">
              <p className="text-[var(--fs-xs)] text-gray-500 leading-snug">
                Build a reusable step-by-step how-to. Link it to any task, or let staff find it in Training.
                It only shows staff how to do the job — it never ticks a task off.
              </p>

              {/* Guide name */}
              <div>
                <label htmlFor="guide-name" className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Guide name
                </label>
                <input
                  id="guide-name"
                  type="text"
                  value={name}
                  maxLength={120}
                  onChange={(e) => { setName(e.target.value); markDirty(); }}
                  placeholder="e.g. Turn on the smoker"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-sm)] text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                />
              </div>

              {/* Draft ⇄ Published switch — labels on both sides make the
                  direction unmistakable: OFF (left) = Draft, ON (right) = Published. */}
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-center gap-3">
                  <span className={`text-[var(--fs-sm)] font-semibold ${!published ? 'text-gray-800' : 'text-gray-400'}`}>Draft</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={published}
                    aria-label="Publish this guide to staff"
                    onClick={() => { setPublished(v => !v); markDirty(); }}
                    className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${published ? 'bg-green-600' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${published ? 'translate-x-5' : ''}`} />
                  </button>
                  <span className={`text-[var(--fs-sm)] font-semibold ${published ? 'text-green-700' : 'text-gray-400'}`}>Published</span>
                </div>
                <p className="text-[var(--fs-xs)] text-gray-500 leading-snug mt-2">
                  {published
                    ? (dirty ? 'Turned on — staff can open it once you save.' : 'On — staff can open this guide. Flip left to make it a draft.')
                    : 'Off — a draft, hidden from staff. Flip the switch right to publish.'}
                </p>
                {/* A draft that has become complete says so. Nothing used to tell
                    you — you had to remember to come back and flip the switch,
                    which is exactly how a finished guide sits in Draft for days
                    and staff see nothing. */}
                {!published && steps.length > 0 && publishBlockers.length === 0 && (
                  <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-2.5 flex items-start gap-2">
                    <span aria-hidden="true" className="text-[var(--fs-sm)] leading-none mt-0.5">✅</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[var(--fs-xs)] font-bold text-green-900">
                        This guide is ready — every step is complete.
                      </p>
                      <p className="text-[var(--fs-xs)] text-green-800 mt-0.5">
                        It stays hidden from staff until you publish it.
                      </p>
                      <button
                        type="button"
                        onClick={() => { setPublished(true); markDirty(); }}
                        className="mt-1.5 min-h-[32px] px-3 inline-flex items-center rounded-lg bg-green-600 text-white text-[var(--fs-xs)] font-bold hover:bg-green-700"
                      >
                        Publish it
                      </button>
                    </div>
                  </div>
                )}
                {published && publishBlockers.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5" role="alert">
                    <p className="text-[var(--fs-xs)] font-bold text-amber-900">
                      Can&apos;t publish yet — a published guide has to be complete for staff:
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {publishBlockers.map(b => (
                        <li key={b} className="text-[var(--fs-xs)] text-amber-800 flex items-start gap-1.5">
                          <span aria-hidden="true">•</span><span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[var(--fs-xs)] text-amber-700">
                      Fix these, or flip back to <b>Draft</b> to save your work as-is.
                    </p>
                  </div>
                )}
              </div>

              {stale && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="text-[var(--fs-xs)] text-red-700 font-semibold">
                    This guide was changed somewhere else. Reload the latest version before saving, or your
                    changes will keep being rejected.
                  </p>
                  <button type="button" onClick={reloadStale} className="text-[var(--fs-xs)] font-bold text-red-700 underline">
                    Reload latest
                  </button>
                </div>
              )}

              {steps.length === 0 ? (
                <p className="text-[var(--fs-sm)] text-gray-500 text-center py-4">No steps yet — add your first below.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={steps.map(s => s.key)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {steps.map((s, i) => (
                        <StepCard
                          key={s.key}
                          step={s}
                          index={i}
                          total={steps.length}
                          frozen={frozen}
                          busy={busySteps.has(s.key)}
                          imgError={imgError.has(s.key)}
                          activeIndex={activePin?.key === s.key ? activePin.index : null}
                          onSetActive={(idx) => setActivePin(idx === null ? null : { key: s.key, index: idx })}
                          onPatch={(patch) => patchStep(s.key, patch)}
                          onPins={(pins) => setPins(s.key, pins)}
                          onDrawings={(d) => setDrawings(s.key, d)}
                          onPickPhoto={(f) => pickPhoto(s.key, f)}
                          onPickPdf={(f) => pickPdf(s.key, f)}
                          onImgError={() => setImgError(prev => { const n = new Set(prev); n.add(s.key); return n; })}
                          onRemove={() => removeStep(s.key)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {/* Add-step control */}
              <div className="rounded-xl border-2 border-dashed border-gray-300 p-3">
                <p className="text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-2">Add a step</p>
                <div className="grid grid-cols-2 gap-2">
                  {STEP_TYPES.map(t => (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => addStep(t.type)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-left hover:border-green-500 hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    >
                      <span className="text-[var(--fs-lg)] leading-none" aria-hidden="true">{t.emoji}</span>
                      <span className="min-w-0">
                        <span className="block text-[var(--fs-sm)] font-semibold text-gray-800">{t.label}</span>
                        <span className="block text-[10px] text-gray-500 leading-tight">{t.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleDelete}
                className="w-full text-[var(--fs-sm)] font-semibold text-red-600 hover:text-red-700 py-2"
              >
                Delete guide
              </button>
            </fieldset>
          )}
        </div>

        {/* Footer */}
        {!loading && !loadError && (
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3 space-y-2 rounded-b-2xl sm:rounded-b-2xl">
            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[var(--fs-sm)] font-semibold text-red-700" role="alert">
                {error}
              </p>
            )}
            {notice && !error && <p className="text-[var(--fs-xs)] font-semibold text-green-700">{notice}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={frozen}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                disabled={frozen || dirty || steps.length === 0}
                title={dirty ? 'Save to preview' : undefined}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={frozen || stale}
                className="flex-[2] py-2.5 rounded-lg bg-green-600 text-white text-[var(--fs-sm)] font-bold hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save guide'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Staff-player preview of the SAVED guide. Enabled only when clean (not
        dirty) with at least one step, since the player reads the saved guide via
        the manager library-preview endpoint (read-only, never completes). */}
    {previewOpen && (
      <GuidedTutorialPlayer source={{ kind: 'library-manager', guideId }} onClose={() => setPreviewOpen(false)} />
    )}
    {confirmElement}
    </>
  );
}

// ── One sortable step card ────────────────────────────────────────────────────

interface StepCardProps {
  step: EditorStep;
  index: number;
  total: number;
  frozen: boolean;
  busy: boolean;
  imgError: boolean;
  activeIndex: number | null;
  onSetActive: (index: number | null) => void;
  onPatch: (patch: Partial<EditorStep>) => void;
  onPins: (pins: GuidePin[]) => void;
  onDrawings: (shapes: GuideDrawing[]) => void;
  onPickPhoto: (file: File) => void;
  onPickPdf: (file: File) => void;
  onImgError: () => void;
  onRemove: () => void;
}

function StepCard({
  step, index, total, frozen, busy, imgError, activeIndex,
  onSetActive, onPatch, onPins, onDrawings, onPickPhoto, onPickPdf, onImgError, onRemove,
}: StepCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.key, disabled: frozen });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : ('auto' as number | string),
  };
  const disabled = frozen || busy;
  const meta = TYPE_META[step.media_type];

  // Focus the note field of a freshly-placed / tapped pin.
  const noteRefs = useRef<Record<number, HTMLInputElement | null>>({});
  useEffect(() => {
    if (activeIndex != null) noteRefs.current[activeIndex]?.focus();
  }, [activeIndex, step.pins.length]);

  // YouTube: only flag an invalid link once the field is blurred, so the red
  // error doesn't flash on every keystroke of an in-progress URL. The positive
  // "Valid YouTube link." confirmation may show as soon as the URL is complete.
  const [ytFocused, setYtFocused] = useState(false);
  const ytUrl = (step.youtube_url || '').trim();
  const ytInvalid = ytUrl.length > 0 && !isValidYoutubeUrl(ytUrl);
  const ytShowError = ytInvalid && !ytFocused;

  return (
    <div ref={setNodeRef} style={style} className={`rounded-xl border bg-white ${step.media_type === 'tip' ? 'border-amber-200' : 'border-gray-200'}`}>
      {/* Card header: drag handle + step number + type + remove */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder step ${index + 1}`}
          className="w-11 h-11 flex-shrink-0 rounded-lg bg-gray-100 active:bg-gray-200 flex items-center justify-center text-gray-400 cursor-grab touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
          </svg>
        </button>
        <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 text-[var(--fs-xs)] font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </span>
        <span className="flex-1 min-w-0 text-[var(--fs-xs)] font-semibold text-gray-500 flex items-center gap-1">
          <span aria-hidden="true">{meta.emoji}</span>{meta.label}
          <span className="text-gray-500"> · Step {index + 1} of {total}</span>
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-[44px] px-2 -mr-1 flex items-center flex-shrink-0 text-[var(--fs-xs)] font-semibold text-red-600 hover:text-red-700"
        >
          Remove
        </button>
      </div>

      <div className="px-3 pb-3 pt-2 space-y-2">
        {/* Media area, by type */}
        {step.media_type === 'photo' && (
          <PhotoStep
            step={step} stepNo={index + 1} disabled={disabled} busy={busy} imgError={imgError} activeIndex={activeIndex}
            noteRefs={noteRefs}
            onSetActive={onSetActive} onPins={onPins} onDrawings={onDrawings} onPickPhoto={onPickPhoto} onImgError={onImgError}
          />
        )}

        {step.media_type === 'youtube' && (
          <div>
            <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">YouTube link</label>
            <input
              type="url"
              inputMode="url"
              value={step.youtube_url || ''}
              onChange={e => onPatch({ youtube_url: e.target.value })}
              onFocus={() => setYtFocused(true)}
              onBlur={() => setYtFocused(false)}
              placeholder="https://www.youtube.com/watch?v=…"
              className={`w-full px-3 py-2 border rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 ${ytShowError ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-green-500'}`}
            />
            {ytShowError ? (
              <p className="text-[var(--fs-xs)] text-red-600 mt-1">That is not a valid YouTube link.</p>
            ) : ytUrl && !ytInvalid ? (
              <p className="text-[var(--fs-xs)] text-green-700 mt-1">Valid YouTube link.</p>
            ) : null}
          </div>
        )}

        {step.media_type === 'pdf' && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            {hasPdf(step) ? (
              <div className="flex items-center gap-2 text-[var(--fs-sm)]">
                <span aria-hidden="true">📄</span>
                <span className="flex-1 min-w-0 truncate text-gray-800">
                  {step.pdfFilename || 'document.pdf'}
                  {step.pdfSize ? <span className="text-gray-500"> · {formatFileSize(step.pdfSize)}</span> : null}
                </span>
                {step.pdfUrl ? (
                  <a href={step.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 flex-shrink-0">Open</a>
                ) : (
                  <span className="text-[var(--fs-xs)] text-gray-400 flex-shrink-0">New — save to view</span>
                )}
              </div>
            ) : (
              <p className="text-[var(--fs-xs)] text-gray-500">No document attached yet.</p>
            )}
            <label className={`mt-2 inline-block text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
              {hasPdf(step) ? 'Replace PDF' : 'Choose PDF'}
              <input
                type="file" accept="application/pdf" className="hidden" disabled={disabled}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickPdf(f); }}
              />
            </label>
            {busy && <span className="ml-2 text-[var(--fs-xs)] text-gray-400">Reading…</span>}
          </div>
        )}

        {/* Explanation — required for every step */}
        <div>
          <label className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
            {step.media_type === 'tip' ? 'Tip / warning' : 'Explanation'}
          </label>
          <textarea
            value={step.explanation}
            onChange={e => onPatch({ explanation: e.target.value })}
            rows={step.media_type === 'tip' ? 3 : 2}
            placeholder={step.media_type === 'tip' ? 'e.g. Never put water on a grease fire.' : 'Explain what to do in this step.'}
            className={`w-full px-3 py-2 border rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 ${
              step.media_type === 'tip'
                ? 'border-amber-300 bg-amber-50 text-amber-900 placeholder-amber-400 focus:ring-amber-400'
                : 'border-gray-200 focus:ring-green-500'
            }`}
          />
          {step.media_type === 'tip' && (
            <p className="text-[var(--fs-xs)] text-amber-600 mt-1 flex items-center gap-1">
              <span aria-hidden="true">⚠️</span> Shown to staff as a highlighted warning.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Photo step body: image + editable note-pins + drawings ────────────────────

const DRAWING_COLOR_NAMES: Record<string, string> = {
  '#DC2626': 'red', '#2563EB': 'blue', '#16A34A': 'green', '#FFFFFF': 'white',
};

function ToolButton({ label, active = false, disabled, onClick }: {
  label: string; active?: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`min-h-[38px] px-2.5 rounded-lg text-[var(--fs-xs)] font-semibold border disabled:opacity-40 ${
        active
          ? 'bg-green-600 border-green-600 text-white'
          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}


interface PhotoStepProps {
  step: EditorStep;
  stepNo: number;
  disabled: boolean;
  busy: boolean;
  imgError: boolean;
  activeIndex: number | null;
  noteRefs: MutableRefObject<Record<number, HTMLInputElement | null>>;
  onSetActive: (index: number | null) => void;
  onPins: (pins: GuidePin[]) => void;
  onDrawings: (shapes: GuideDrawing[]) => void;
  onPickPhoto: (file: File) => void;
  onImgError: () => void;
}

function PhotoStep({ step, stepNo, disabled, busy, imgError, activeIndex, noteRefs, onSetActive, onPins, onDrawings, onPickPhoto, onImgError }: PhotoStepProps) {
  const [chooser, setChooser] = useState(false);   // Camera·Photos·Files (photo-inputs skill)
  /** Active drawing tool — null means "place note-pins" (the default). */
  const [tool, setTool] = useState<GuideDrawingType | null>(null);
  const [color, setColor] = useState<string>(DRAWING_COLORS[0]);
  /** Line weight LEVEL (1..5) for the next mark — and for the selected one. */
  const [lineWidth, setLineWidth] = useState<number>(DEFAULT_DRAWING_WIDTH);
  /** True when the author tried to add a mark beyond the cap (so we can say so). */
  const [capHit, setCapHit] = useState(false);
  /** Index of the mark the author tapped — movable, stretchable, deletable. */
  const [selectedMark, setSelectedMark] = useState<number | null>(null);
  const { confirm, confirmElement } = useConfirm();
  const photo = hasPhoto(step);
  const shapes = step.drawings;
  // Keep the selection valid: undo/clear/erase can remove the selected mark, and
  // leaving a stale index would highlight the wrong shape.
  useEffect(() => {
    if (selectedMark != null && selectedMark >= shapes.length) setSelectedMark(null);
  }, [selectedMark, shapes.length]);
  // Selection only means something while a drawing tool is active.
  useEffect(() => {
    if (!tool) setSelectedMark(null);
  }, [tool]);
  // Selecting a mark loads its style into the pickers, so the toolbar always
  // describes what is selected instead of quietly disagreeing with it.
  useEffect(() => {
    if (selectedMark == null) return;
    const s = shapes[selectedMark];
    if (!s) return;
    setColor(s.color);
    setLineWidth(clampDrawingWidth(s.width));
  }, [selectedMark, shapes]);

  /**
   * The colour / thickness pickers set the style of the NEXT mark — and, when a
   * mark is selected, restyle that one too. Without this a line drawn too thin
   * could only be fixed by erasing and redrawing it.
   */
  function applyStyle(patch: Partial<Pick<GuideDrawing, 'color' | 'width'>>) {
    if (patch.color !== undefined) setColor(patch.color);
    if (patch.width !== undefined) setLineWidth(patch.width);
    if (selectedMark != null && shapes[selectedMark]) {
      onDrawings(shapes.map((s, i) => (i === selectedMark ? { ...s, ...patch } : s)));
    }
  }


  /**
   * ONE path in for picker AND drop. Routing the drop through here matters: a
   * dropped replacement must hit the same pin-wipe confirmation, or dragging a
   * new photo onto a pinned step would silently discard its notes.
   */
  async function acceptPhoto(f: File | null | undefined) {
    if (!f) return;
    // Replacing a photo wipes its pins AND drawings — both point at the old
    // image, so their coordinates go stale. Confirm before discarding either.
    const marks = step.pins.length + shapes.length;
    if (photo && marks > 0 && !await confirm({
      title: 'Replace this photo?',
      message: 'Its note-pins and drawings are removed, because they point at the old photo.',
      confirmLabel: 'Replace photo',
      variant: 'danger',
    })) return;
    onPickPhoto(f);
  }

  // Shared place-a-pin path for BOTH tap-to-place (pointer) and the keyboard
  // "Add pin" button. Focus follows the new pin's note input (via onSetActive)
  // so a keyboard user can type its note, then Tab to the pin to nudge it.
  function placePin(x: number, y: number) {
    if (disabled) return;
    const next = [...step.pins, { pin_x: clamp01(x), pin_y: clamp01(y), note: '' }];
    onPins(next);
    onSetActive(next.length - 1);
  }

  return (
    <div className="space-y-2">
      {confirmElement}
      {chooser && (
        <PhotoSourceSheet
          title="Step photo"
          disabled={disabled}
          onFile={(f: File) => void acceptPhoto(f)}
          onClose={() => setChooser(false)}
        />
      )}
      <DropZone onFiles={(fs) => acceptPhoto(fs[0])} disabled={disabled}
        hint={photo ? 'Drop to replace' : 'Drop the photo here'}>
      {!photo ? (
        <button type="button" onClick={() => setChooser(true)} disabled={disabled}
          className={`w-full flex flex-col items-center justify-center gap-1 px-3 py-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-[var(--fs-xs)] font-semibold text-gray-500 hover:bg-gray-100 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <span className="text-2xl" aria-hidden="true">📷</span>
          {busy ? 'Processing…' : 'Add a photo'}
        </button>
      ) : imgError ? (
        // Corrupt stored photo — offer a replacement input right here so the step
        // isn't a dead-end (deleting the whole step used to be the only way out).
        <div className="px-3 py-5 bg-white border border-red-200 rounded-lg text-center space-y-2">
          <p className="text-[var(--fs-xs)] text-red-600">Couldn&apos;t load this photo. Replace it below.</p>
          <button type="button" onClick={() => setChooser(true)} disabled={disabled}
            className={`min-h-[44px] inline-flex items-center justify-center text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy ? 'Processing…' : 'Choose a new photo'}
          </button>
        </div>
      ) : (
        <div className="flex justify-center bg-gray-50 rounded-lg p-1">
          <PinnableImage
            src={step.photoUrl || ''}
            alt={`Step ${stepNo} photo`}
            mode="edit"
            disabled={disabled}
            pins={step.pins.map((p, i) => ({ pin_x: p.pin_x, pin_y: p.pin_y, label: p.note || `Note ${i + 1}`, number: i + 1 }))}
            activeIndex={activeIndex}
            onPlace={placePin}
            onPinMove={(i, x, y) => onPins(step.pins.map((p, idx) => (idx === i ? { ...p, pin_x: x, pin_y: y } : p)))}
            onPinClick={(i) => onSetActive(activeIndex === i ? null : i)}
            onImageError={onImgError}
            drawings={shapes}
            drawTool={tool}
            drawColor={color}
            drawWidth={lineWidth}
            onDrawAdd={(shape) => {
              // Never swallow the mark the author just drew: if we're at the cap,
              // say so instead of silently dropping it.
              if (shapes.length >= MAX_DRAWINGS) { setCapHit(true); return; }
              setCapHit(false);
              onDrawings([...shapes, shape]);
              // Select it straight away, so it can be nudged or stretched
              // without hunting for it first.
              setSelectedMark(shapes.length);
            }}
            drawSelected={selectedMark}
            onDrawSelect={setSelectedMark}
            onDrawUpdate={(i, shape) => onDrawings(shapes.map((s, idx) => (idx === i ? shape : s)))}
          />
        </div>
      )}

      {/* Drawing tools — circle a button, arrow to a dial, or scribble freehand.
          "Dots" is the default so the long-standing tap-to-place-a-pin behaviour
          is unchanged until a drawing tool is deliberately picked. */}
      {photo && !imgError && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg">
          <ToolButton label="● Dots" active={tool === null} disabled={disabled} onClick={() => setTool(null)} />
          <ToolButton label="↗ Arrow" active={tool === 'arrow'} disabled={disabled} onClick={() => setTool('arrow')} />
          <ToolButton label="◯ Circle" active={tool === 'circle'} disabled={disabled} onClick={() => setTool('circle')} />
          <ToolButton label="▭ Box" active={tool === 'box'} disabled={disabled} onClick={() => setTool('box')} />
          <ToolButton label="✎ Pen" active={tool === 'pen'} disabled={disabled} onClick={() => setTool('pen')} />
          <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
          {DRAWING_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => applyStyle({ color: c })}
              disabled={disabled}
              aria-label={`Draw in ${DRAWING_COLOR_NAMES[c]}`}
              aria-pressed={color === c}
              title={DRAWING_COLOR_NAMES[c]}
              style={{ background: c }}
              className={`w-7 h-7 rounded-full border-2 border-white disabled:opacity-50 ${
                color === c ? 'ring-2 ring-gray-800 scale-110' : 'ring-1 ring-gray-300'
              }`}
            />
          ))}
          <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
          {/* Five line weights, drawn at their real thickness so the picker shows
              what you get. Thin lines disappear on a busy kitchen photo. */}
          {DRAWING_WIDTH_LEVELS.map(lvl => (
            <button
              key={lvl}
              type="button"
              onClick={() => applyStyle({ width: lvl })}
              disabled={disabled}
              aria-label={`Line thickness ${lvl} of ${DRAWING_WIDTH_LEVELS.length}`}
              aria-pressed={lineWidth === lvl}
              title={`Thickness ${lvl}`}
              className={`w-7 h-7 flex items-center justify-center rounded-md bg-white disabled:opacity-50 ${
                lineWidth === lvl ? 'ring-2 ring-gray-800' : 'ring-1 ring-gray-300'
              }`}
            >
              <span
                aria-hidden="true"
                className="block w-4 rounded-full bg-gray-800"
                style={{ height: `${drawingWidthPx(lvl)}px` }}
              />
            </button>
          ))}
          <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
          <ToolButton
            label="⌫ Erase"
            disabled={disabled || selectedMark == null}
            onClick={() => {
              if (selectedMark == null) return;
              setCapHit(false);
              onDrawings(shapes.filter((_, idx) => idx !== selectedMark));
              setSelectedMark(null);
            }}
          />
          <ToolButton
            label="↶ Undo"
            disabled={disabled || shapes.length === 0}
            onClick={() => { setCapHit(false); setSelectedMark(null); onDrawings(shapes.slice(0, -1)); }}
          />
          <ToolButton
            label="Clear"
            disabled={disabled || shapes.length === 0}
            onClick={async () => {
              if (!await confirm({
                title: 'Remove all drawings?',
                message: 'Every mark on this photo goes. The numbered note-pins stay.',
                confirmLabel: 'Remove all',
                variant: 'danger',
              })) return;
              setCapHit(false);
              setSelectedMark(null);
              onDrawings([]);
            }}
          />
          {capHit && (
            <span className="w-full text-[var(--fs-xs)] font-semibold text-red-600 mt-0.5">
              That is the most marks one photo can hold ({MAX_DRAWINGS}). Erase one first.
            </span>
          )}
          {tool && !capHit && (
            <span className="w-full text-[var(--fs-xs)] text-gray-500 mt-0.5">
              {selectedMark != null
                ? 'Drag the mark to move it, or its white handles to stretch it. Colour and thickness restyle it; Erase deletes it.'
                : 'Drag on the photo to draw. Tap a mark to move, stretch, restyle or erase it.'}
              {' '}Pick <strong>Dots</strong> to place numbered notes again.
            </span>
          )}
        </div>
      )}

      {photo && !imgError && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--fs-xs)] text-gray-500 min-w-0">
            {step.pins.length} note-pin{step.pins.length === 1 ? '' : 's'} · tap the photo or Add pin
          </span>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Keyboard path to create a pin (WCAG 2.1.1): places one at centre,
                then arrows nudge it and the note field takes focus to describe it. */}
            <button
              type="button"
              onClick={() => placePin(0.5, 0.5)}
              disabled={disabled}
              className="min-h-[44px] flex items-center px-1 text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 disabled:opacity-50"
            >
              + Add pin
            </button>
            <button type="button" onClick={() => setChooser(true)} disabled={disabled}
              className={`min-h-[44px] flex items-center text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
              {busy ? 'Processing…' : 'Replace photo'}
            </button>
          </div>
        </div>
      )}
      </DropZone>

      {/* Note-pin list — each pin carries an editable note (required). */}
      {step.pins.length > 0 && (
        <ul className="space-y-1">
          {step.pins.map((p, i) => (
            <li
              key={i}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${activeIndex === i ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}
            >
              <span className="w-5 h-5 rounded-full bg-green-600 text-white text-[var(--fs-xs)] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <input
                ref={el => { noteRefs.current[i] = el; }}
                value={p.note}
                onChange={e => onPins(step.pins.map((pp, idx) => (idx === i ? { ...pp, note: e.target.value } : pp)))}
                onFocus={() => onSetActive(i)}
                placeholder="What is this pin pointing at?"
                className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded-md text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="button"
                onClick={() => { onPins(step.pins.filter((_, idx) => idx !== i)); onSetActive(null); }}
                className="text-[var(--fs-xs)] font-semibold text-red-500 hover:text-red-600 flex-shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
