'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GuidedTutorialEditor from './GuidedTutorialEditor';
import type { LibraryGuideSummary, GuideLink } from '@/lib/task-guide';

/**
 * GuidePicker — the "Guided tutorial" section inside a task's editor modal.
 *
 * A task LINKS one reusable library guide (many tasks → one guide). This lets a
 * manager: link an existing guide, create+link a new one, edit the linked guide
 * (edits apply everywhere it's linked), or detach it. Editing/creating opens the
 * shared GuidedTutorialEditor on the guide id. The guide never completes the task.
 */

interface Props {
  templateId: number;
  lineId: number;
  /** Task name — the default name when creating a new guide from here. */
  taskName: string;
  /** Fired whenever the link changes, so the task list row can refresh its badge. */
  onChanged?: () => void;
}

export default function GuidePicker({ templateId, lineId, taskName, onChanged }: Props) {
  const linkUrl = `/api/tasks/templates/${templateId}/lines/${lineId}/guide-link`;
  const [link, setLink] = useState<GuideLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Open editor on this guide id (0 = closed).
  const [editGuide, setEditGuide] = useState<{ id: number; name: string } | null>(null);
  // Attach-picker modal open?
  const [picking, setPicking] = useState(false);

  const gen = useRef(0);
  const loadLink = useCallback(async () => {
    const myGen = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(linkUrl, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not load the guide link.');
      if (myGen !== gen.current) return;
      setLink(body as GuideLink);
    } catch (e: unknown) {
      if (myGen !== gen.current) return;
      setError(e instanceof Error ? e.message : 'Could not load the guide link.');
    } finally {
      if (myGen === gen.current) setLoading(false);
    }
  }, [linkUrl]);

  useEffect(() => { void loadLink(); }, [loadLink]);

  const attach = useCallback(async (guideId: number | null): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(linkUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ guide_id: guideId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not update the guide link.');
      setLink((body?.link as GuideLink) ?? null);
      onChanged?.();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update the guide link.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [linkUrl, onChanged]);

  const linked = !!link?.guide_id;

  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Guided tutorial</label>

      {loading ? (
        <p className="text-[12px] text-gray-400">Loading…</p>
      ) : linked ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none" aria-hidden="true">📖</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 truncate">{link!.name || 'Guide'}</p>
              <p className="text-[11px] text-gray-500">
                {link!.step_count} step{link!.step_count === 1 ? '' : 's'} ·{' '}
                <span className={link!.published ? 'text-green-700 font-semibold' : 'text-gray-500'}>
                  {link!.published ? 'Live' : 'Draft'}
                </span>
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditGuide({ id: link!.guide_id as number, name: link!.name })}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              Edit guide
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPicking(true)}
              className="py-2 px-3 rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { if (confirm('Unlink this guide from the task? The guide itself is kept in the library.')) void attach(null); }}
              className="py-2 px-3 rounded-lg border border-gray-200 text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Unlink
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Edits to this guide apply everywhere it&rsquo;s linked. It never completes the task.</p>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            📖 Link a guide
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600 font-semibold mt-1">{error}</p>}
      {!linked && !loading && (
        <p className="text-[11px] text-gray-400 mt-1">Optional — a step-by-step how-to staff can open. It never completes the task.</p>
      )}

      {picking && (
        <GuideAttachModal
          taskName={taskName}
          currentGuideId={link?.guide_id || null}
          onClose={() => setPicking(false)}
          onPick={async (g) => { setPicking(false); await attach(g.id); }}
          onCreated={async (guideId, name) => {
            setPicking(false);
            // Only present the new guide as the task's guide if it actually linked;
            // a failed attach leaves an (unlinked) library draft + a visible error.
            if (await attach(guideId)) setEditGuide({ id: guideId, name });
          }}
        />
      )}

      {editGuide && (
        <GuidedTutorialEditor
          guideId={editGuide.id}
          guideName={editGuide.name}
          onClose={() => setEditGuide(null)}
          onSaved={() => { void loadLink(); onChanged?.(); }}
          onDeleted={() => { setEditGuide(null); void loadLink(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

/** Modal: pick an existing library guide to link, or create a new one. Exported
 * so the add-task form can reuse it to pick a guide for a not-yet-saved task. */
export function GuideAttachModal({
  taskName, currentGuideId, onClose, onPick, onCreated,
}: {
  taskName: string;
  currentGuideId: number | null;
  onClose: () => void;
  onPick: (guide: { id: number; name: string }) => void;
  onCreated: (guideId: number, name: string) => void;
}) {
  const [guides, setGuides] = useState<LibraryGuideSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(taskName || '');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks/guides', { credentials: 'same-origin' })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Could not load guides.');
        return Array.isArray(body.guides) ? (body.guides as LibraryGuideSummary[]) : [];
      })
      .then(gs => { if (!cancelled) setGuides(gs); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load guides.'); });
    return () => { cancelled = true; };
  }, []);

  async function createGuide() {
    const name = newName.trim();
    if (!name) { setError('Give the new guide a name.'); return; }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not create the guide.');
      onCreated(body.id as number, name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create the guide.');
      setCreating(false);
    }
  }

  const filtered = (guides ?? []).filter(g => g.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85dvh] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-blue-600 text-white px-4 py-3 rounded-t-2xl flex items-center justify-between gap-3 flex-shrink-0">
          <h2 className="text-base font-bold">Choose a guide</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-white/90 hover:bg-white/15">
            <span aria-hidden="true" className="text-lg leading-none">✕</span>
          </button>
        </div>

        <div className="p-3 flex-1 overflow-y-auto min-h-0 space-y-3">
          {/* Create new */}
          <div className="rounded-lg border border-dashed border-gray-300 p-3">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Create a new guide</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                maxLength={120}
                onChange={e => setNewName(e.target.value)}
                placeholder="Guide name"
                className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              <button
                type="button"
                onClick={createGuide}
                disabled={creating}
                className="px-3 py-2 rounded-lg bg-green-600 text-white text-[13px] font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {creating ? '…' : 'Create'}
              </button>
            </div>
          </div>

          {/* Existing */}
          <div>
            <input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search guides…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            {guides === null ? (
              <p className="text-[12px] text-gray-400 py-4 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-[12px] text-gray-400 py-4 text-center">
                {guides.length === 0 ? 'No guides yet — create one above.' : 'No guides match your search.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {filtered.map(g => (
                  <li key={g.id}>
                    <button
                      type="button"
                      disabled={g.id === currentGuideId}
                      onClick={() => onPick({ id: g.id, name: g.name })}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-left hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-default"
                    >
                      <span className="text-base" aria-hidden="true">📖</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-800 truncate">{g.name}</span>
                        <span className="block text-[11px] text-gray-500">
                          {g.step_count} step{g.step_count === 1 ? '' : 's'} · {g.published ? 'Live' : 'Draft'}
                          {g.template_line_count > 0 ? ` · used by ${g.template_line_count}` : ''}
                        </span>
                      </span>
                      {g.id === currentGuideId
                        ? <span className="text-[11px] font-semibold text-blue-600">Linked</span>
                        : <span className="text-[11px] font-semibold text-blue-600">Use</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-[12px] text-red-600 font-semibold">{error}</p>}
        </div>
      </div>
    </div>
  );
}
