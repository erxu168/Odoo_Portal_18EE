'use client';

/**
 * "Write it for me" — photos and a few bullets in, a draft guide out.
 *
 * Two phases in one modal: compose, then review. The review phase is the point
 * of the whole screen. What comes back is AI-written text about handling fire
 * and food, so it is presented as a DRAFT that a person has to read, and the
 * only way it reaches a cook is if that person saves it and later publishes it.
 * Nothing here can publish.
 *
 * Photos go in the order they are added, and that order is the order the guide
 * teaches — the server prompt forbids re-sequencing, because the author
 * photographed the job as it happens and that sequence IS the instruction.
 */
import { useState } from 'react';
import PhotoSourceSheet from '@/components/ui/PhotoSourceSheet';
import { DropZone } from '@/components/ui/DropZone';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { useConfirm } from '@/components/ui/useConfirm';
import { compressImage } from './photoUpload';

/** Matches the server's MAX_PHOTOS. Twelve steps is already a long guide. */
const MAX_PHOTOS = 12;
const MAX_BULLETS = 4000;

interface Shot {
  /** Base64 without the data: prefix — what both the API and the save want. */
  base64: string;
  filename: string;
  /** For the <img> preview before anything is uploaded. */
  dataUrl: string;
}

interface DraftStep { photo_index: number; heading: string; explanation: string }
interface DraftAnswer { text: string; is_correct: boolean }
interface DraftQuestion { text: string; explain_step: number; answers: DraftAnswer[] }
interface Draft { name: string; steps: DraftStep[]; questions: DraftQuestion[] }

export default function AiGuideWriter({ onClose, onCreated }: {
  onClose: () => void;
  /** A draft guide was saved — the library reloads and opens it for editing. */
  onCreated: (guideId: number) => void;
}) {
  const [title, setTitle] = useState('');
  const [bullets, setBullets] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [chooser, setChooser] = useState(false);
  const [busy, setBusy] = useState(false);          // compressing a photo
  const [writing, setWriting] = useState(false);    // the model is thinking
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { confirm, confirmElement } = useConfirm();

  async function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - shots.length;
    if (room <= 0) {
      setError(`That is the most photos one guide can take (${MAX_PHOTOS}). Split it into two.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const next: Shot[] = [];
      for (const f of files.slice(0, room)) {
        const { base64, filename } = await compressImage(f, 1280, 0.85);
        next.push({ base64, filename, dataUrl: `data:image/jpeg;base64,${base64}` });
      }
      setShots(prev => [...prev, ...next]);
    } catch {
      setError('Could not read one of those photos — try a JPEG or PNG.');
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, dir: -1 | 1) {
    setShots(prev => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const out = [...prev];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }

  async function generate() {
    if (!title.trim()) { setError('Give the guide a title first.'); return; }
    if (!shots.length) { setError('Add at least one photo.'); return; }
    if (!bullets.trim()) { setError('Add a few notes — the photos alone do not say what matters.'); return; }
    setWriting(true); setError(null);
    try {
      const res = await fetch('/api/tasks/guides/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          bullets,
          photos: shots.map(s => ({ base64: s.base64, media_type: 'image/jpeg' })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) { setError(body.error || 'Could not write the guide.'); return; }
      setDraft(body.guide as Draft);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWriting(false);
    }
  }

  /** Save the draft as a DRAFT guide — never published. Three calls, because
   *  the guide, its steps and its questions are three separate write paths on
   *  purpose (the step save rebuilds the whole aggregate). */
  async function keep() {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const made = await fetch('/api/tasks/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name || title.trim() }),
      });
      const g = await made.json().catch(() => ({}));
      if (!made.ok || !g.id) { setError(g.error || 'Could not create the guide.'); return; }

      const steps = draft.steps.map(s => ({
        media_type: 'photo' as const,
        explanation: s.heading ? `${s.heading}\n${s.explanation}` : s.explanation,
        image_base64: shots[s.photo_index]?.base64,
        image_filename: shots[s.photo_index]?.filename || 'photo.jpg',
      })).filter(s => s.image_base64);

      const saved = await fetch(`/api/tasks/guides/${g.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: g.revision ?? 0, published: false, name: draft.name || title.trim(), steps }),
      });
      const sBody = await saved.json().catch(() => ({}));
      if (!saved.ok) {
        // The guide exists but is empty. Say so rather than leaving a mystery
        // shell in the library with no explanation.
        setError((sBody.error || 'Could not save the steps.') + ' The guide was created but is empty — open it and try again.');
        onCreated(g.id);
        return;
      }

      if (draft.questions.length) {
        const q = await fetch(`/api/tasks/guides/${g.id}/questions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions: draft.questions }),
        });
        if (!q.ok) {
          // The guide and its steps are safe; only the questions failed. That is
          // worth finishing on, not rolling back.
          const qb = await q.json().catch(() => ({}));
          setError((qb.error || 'The questions could not be saved.') + ' The guide itself is saved.');
        }
      }
      onCreated(g.id);
    } catch {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!await confirm({
      title: 'Throw this draft away?',
      message: 'The photos and notes stay; only what was written goes.',
      confirmLabel: 'Throw it away',
      variant: 'danger',
    })) return;
    setDraft(null);
  }

  async function close() {
    if ((shots.length || bullets.trim() || draft) && !await confirm({
      title: 'Close without saving?',
      message: 'Your photos, notes and anything written go.',
      confirmLabel: 'Close',
      variant: 'danger',
    })) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={close}>
      {confirmElement}
      {chooser && (
        <PhotoSourceSheet
          title="Step photo"
          disabled={busy}
          onFile={(f: File) => void addPhotos([f])}
          onClose={() => setChooser(false)}
        />
      )}
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-shrink-0">
          <h2 className="font-bold text-gray-800 text-[var(--fs-lg)]">
            {draft ? 'Read it before you keep it' : 'Write it for me'}
          </h2>
          <button type="button" onClick={close} aria-label="Close"
            className="w-11 h-11 -mr-2 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700">
            <span aria-hidden="true" className="text-[var(--fs-lg)] leading-none">✕</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0 pb-2">
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[var(--fs-xs)] font-semibold text-red-700">
              {error}
            </p>
          )}

          {!draft ? (
            <>
              <div>
                <label htmlFor="ai-title" className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  What is this guide for?
                </label>
                <input
                  id="ai-title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="How to operate the grill"
                  className="w-full px-3 min-h-[44px] border border-gray-200 rounded-lg text-[var(--fs-sm)] focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <p className="text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Photos — in the order it happens
                </p>
                <DropZone onFiles={fs => void addPhotos(fs)} multiple disabled={busy} hint="Drop the photos here">
                  <div className="grid grid-cols-3 gap-2">
                    {shots.map((s, i) => (
                      <div key={i} className="relative aspect-square rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.dataUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                        <span className="absolute left-1 top-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold grid place-items-center">
                          {i + 1}
                        </span>
                        <div className="absolute inset-x-0 bottom-0 flex">
                          <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                            aria-label={`Move photo ${i + 1} earlier`}
                            className="flex-1 h-7 bg-black/55 text-white text-[11px] disabled:opacity-30">←</button>
                          <button type="button" onClick={() => setShots(p => p.filter((_, j) => j !== i))}
                            aria-label={`Remove photo ${i + 1}`}
                            className="flex-1 h-7 bg-black/55 text-white text-[11px]">✕</button>
                          <button type="button" onClick={() => move(i, 1)} disabled={i === shots.length - 1}
                            aria-label={`Move photo ${i + 1} later`}
                            className="flex-1 h-7 bg-black/55 text-white text-[11px] disabled:opacity-30">→</button>
                        </div>
                      </div>
                    ))}
                    {shots.length < MAX_PHOTOS && (
                      <button type="button" onClick={() => setChooser(true)} disabled={busy}
                        className="aspect-square rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-2xl grid place-items-center disabled:opacity-50">
                        {busy ? '…' : '+'}
                      </button>
                    )}
                  </div>
                </DropZone>
                <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                  Camera, camera roll, files, or drag them in. The order you set is the order it teaches.
                </p>
              </div>

              <div>
                <label htmlFor="ai-notes" className="block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  What matters
                </label>
                <textarea
                  id="ai-notes"
                  value={bullets}
                  onChange={e => setBullets(e.target.value.slice(0, MAX_BULLETS))}
                  rows={6}
                  placeholder={'- gas on first, then igniter, never the other way\n- 20 min to come up to temp, don’t rush it\n- back left runs cooler, put chicken there'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[var(--fs-sm)] leading-relaxed focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                  Rough notes are fine. Say the things people get wrong — that is what a guide is for.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-[var(--fs-xs)] leading-snug text-indigo-900">
                <b className="font-extrabold">Read this before you keep it.</b> It was written from your
                photos and notes, it has not been saved, nobody can see it, and it can be wrong about
                things that matter.
              </div>

              {draft.steps.map((s, i) => (
                <div key={i} className="flex gap-3 py-2 border-b border-gray-100 last:border-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shots[s.photo_index]?.dataUrl} alt=""
                    className="w-14 h-14 rounded-lg border border-gray-200 object-cover flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400">
                      Step {i + 1}{s.heading ? ` · ${s.heading}` : ''}
                    </p>
                    <p className="text-[var(--fs-sm)] text-gray-700 leading-snug mt-0.5">{s.explanation}</p>
                  </div>
                </div>
              ))}

              {draft.questions.length > 0 && (
                <div>
                  <p className="text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mt-3 mb-1">
                    {draft.questions.length} question{draft.questions.length === 1 ? '' : 's'} it drafted
                  </p>
                  {draft.questions.map((q, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 p-2.5 mb-2">
                      <p className="text-[var(--fs-sm)] font-semibold text-gray-800 leading-snug">{q.text}</p>
                      <ul className="mt-1.5 space-y-0.5">
                        {q.answers.map((a, j) => (
                          <li key={j} className="flex items-center gap-2 text-[var(--fs-xs)] text-gray-600">
                            <span className={`w-3 h-3 rounded-full flex-shrink-0 border ${
                              a.is_correct ? 'bg-green-500 border-green-500' : 'border-gray-300'
                            }`} />
                            {a.text}
                          </li>
                        ))}
                      </ul>
                      {q.explain_step > 0 && (
                        <p className="text-[10px] text-gray-400 mt-1.5">covers step {q.explain_step}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[var(--fs-xs)] text-gray-400">
                Keeping it saves a <b>draft</b> guide and opens it for editing. Staff see nothing until
                you publish it yourself.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          {!draft ? (
            <>
              <PrimaryButton busy={writing} disabled={busy} onClick={generate} className="w-full">
                {writing ? 'Writing… about 30 seconds' : '✨ Write the guide'}
              </PrimaryButton>
              <p className="text-[var(--fs-xs)] text-gray-400 text-center">
                {shots.length
                  ? `${shots.length} photo${shots.length === 1 ? '' : 's'} · a few cents · English`
                  : 'Add photos and notes to begin'}
              </p>
            </>
          ) : (
            <>
              <PrimaryButton busy={saving} onClick={keep} className="w-full">
                Keep it as a draft guide
              </PrimaryButton>
              <div className="flex gap-2">
                <button type="button" onClick={() => void generate()} disabled={saving || writing}
                  className="flex-1 min-h-[44px] rounded-xl border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  {writing ? 'Writing…' : '↻ Write it again'}
                </button>
                <button type="button" onClick={() => void discard()} disabled={saving}
                  className="flex-1 min-h-[44px] rounded-xl border border-gray-200 text-[var(--fs-sm)] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50">
                  Throw away
                </button>
              </div>
              <p className="text-[var(--fs-xs)] text-gray-400 text-center">Writing it again costs again.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
