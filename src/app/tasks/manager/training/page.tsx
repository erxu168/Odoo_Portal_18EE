'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import ManagerTabs from '../../_components/ManagerTabs';
import GuidedTutorialEditor from '../../_components/GuidedTutorialEditor';
import GuidedTutorialPlayer from '../../_components/GuidedTutorialPlayer';
import type { LibraryGuideSummary } from '@/lib/task-guide';

/*
 * Guide Library — manager screen for reusable guided how-tos (krawings.task.guide).
 * A guide is a standalone, reusable step-by-step tutorial (photo / video / tip / PDF)
 * that daily tasks LINK to; editing a guide updates it everywhere it's linked. This
 * page lists guides, lets a manager create / edit / delete them, and shows how many
 * tasks use each. The editor itself lives in GuidedTutorialEditor (full-screen modal).
 *
 * Server contract (all same-origin JSON, manager-gated in the API):
 *   GET    /api/tasks/guides            → { guides: LibraryGuideSummary[] }
 *   POST   /api/tasks/guides            → { ok, id, revision }  (400 if a company is needed)
 *   DELETE /api/tasks/guides/{id}       → { ok } | 409 { error } when a task still links it
 */

type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

export default function GuideLibraryPage() {
  const router = useRouter();

  // ── Manager gate. The API enforces this too, but hide the screen from staff so a
  // non-manager never sees a wall of errors. Redirect to /tasks (mirrors the admin page).
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'denied'>('checking');
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const role = d?.user?.role;
        if (role === 'manager' || role === 'admin') setAuthState('ok');
        else { setAuthState('denied'); router.replace('/tasks'); }
      })
      .catch(() => { if (alive) { setAuthState('denied'); router.replace('/tasks'); } });
    return () => { alive = false; };
  }, [router]);

  // ── Guide list, with a staleness token so a slow in-flight fetch can't overwrite
  // newer state (mirrors the async-load discipline used across the portal).
  const [guides, setGuides] = useState<LibraryGuideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/guides', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (token !== reqSeq.current) return; // a newer load superseded this one
      if (!res.ok) { setError(body?.error || 'Could not load the guides.'); return; }
      setGuides(Array.isArray(body.guides) ? body.guides : []);
    } catch (e: unknown) {
      if (token !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (token === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { if (authState === 'ok') load(); }, [authState, load]);

  // ── Search (client-side, case-insensitive, by name). ────────────────────────
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = q ? guides.filter(g => g.name.toLowerCase().includes(q)) : guides;

  // ── New-guide dialog + open editor state. ───────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  function openCreated(id: number, name: string) {
    setShowCreate(false);
    setEditing({ id, name });
    // POST already persisted an empty draft; refetch so the row is present in the
    // list even if the manager closes the editor without saving anything.
    load();
  }

  // ── Delete a guide. 409 = still linked by a task → keep the row, show the reason.
  const [deletingId, setDeletingId] = useState<number | null>(null);
  async function handleDelete(g: LibraryGuideSummary) {
    if (deletingId) return;
    if (!confirm(`Delete "${g.name}"? This permanently removes the guide. Tasks that already ran keep their own copy. This can't be undone.`)) return;
    setDeletingId(g.id);
    try {
      const res = await fetch(`/api/tasks/guides/${g.id}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        // 409 (or any failure): do NOT remove the row — surface the server's message.
        setToast({ message: body?.error || 'Could not delete the guide.', type: 'error' });
        return;
      }
      // Remove immediately (no full reload needed), then reconcile with the server.
      setGuides(prev => prev.filter(x => x.id !== g.id));
      setToast({ message: 'Guide deleted.', type: 'success' });
      load();
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Could not delete the guide.', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  if (authState !== 'ok') {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="TASK MANAGER" title="Guide Library" showBack onBack={() => router.push('/tasks/manager')} />
        <div className="max-w-2xl mx-auto px-4 py-10 text-center text-sm text-gray-400">
          {authState === 'denied' ? 'Redirecting…' : 'Loading…'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="TASK MANAGER"
        title="Guide Library"
        showBack
        onBack={() => router.push('/tasks/manager')}
      />

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-500 mb-3 leading-snug">
          Reusable step-by-step how-tos. Link a guide to any task — editing it here updates it everywhere.
        </p>

        {/* Search */}
        <div className="relative mb-3">
          <svg
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search guides"
            aria-label="Search guides by name"
            className="w-full h-11 pl-10 pr-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Primary action — one green button. */}
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full min-h-[48px] mb-4 rounded-xl bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-700 active:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New guide
        </button>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-red-700 font-semibold">{error}</p>
            <button
              type="button"
              onClick={load}
              className="min-h-[44px] px-4 text-sm font-semibold text-green-700 hover:text-green-800"
            >
              Try again
            </button>
          </div>
        ) : guides.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-3xl mb-2">📘</p>
            <p className="font-semibold text-gray-700 text-sm">No guides yet</p>
            <p className="text-xs text-gray-400 mt-1">Create your first with the button above.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="font-semibold text-gray-700 text-sm">No matches</p>
            <p className="text-xs text-gray-400 mt-1">No guide names contain “{query.trim()}”.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(g => (
              <GuideRow
                key={g.id}
                guide={g}
                deleting={deletingId === g.id}
                onOpen={() => setEditing({ id: g.id, name: g.name })}
                onPreview={() => setPreviewing(g.id)}
                onDelete={() => handleDelete(g)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateGuideDialog
          onClose={() => setShowCreate(false)}
          onCreated={openCreated}
        />
      )}

      {editing && (
        <GuidedTutorialEditor
          guideId={editing.id}
          guideName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={() => load()}
          onDeleted={() => { setEditing(null); load(); }}
        />
      )}

      {previewing !== null && (
        <GuidedTutorialPlayer
          source={{ kind: 'library-manager', guideId: previewing }}
          onClose={() => setPreviewing(null)}
        />
      )}

      <Toast
        message={toast?.message || ''}
        type={toast?.type}
        visible={!!toast}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}

// ── One guide row (white card). Tapping it opens the editor; the trash button
// (stops propagation) deletes it. ────────────────────────────────────────────
function GuideRow({
  guide, deleting, onOpen, onPreview, onDelete,
}: {
  guide: LibraryGuideSummary;
  deleting: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const used = guide.template_line_count;
  return (
    <div className={`flex items-stretch bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${deleting ? 'opacity-50' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        disabled={deleting}
        className="flex-1 min-w-0 text-left px-4 py-3.5 hover:bg-green-50/40 active:bg-green-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 disabled:pointer-events-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-bold text-sm text-gray-800 truncate">{guide.name}</p>
          <StatusPill published={guide.published} />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {guide.step_count} step{guide.step_count === 1 ? '' : 's'}
          {used > 0 ? <span> · Used by {used} task{used === 1 ? '' : 's'}</span> : null}
        </p>
      </button>
      <button
        type="button"
        onClick={onPreview}
        disabled={deleting}
        aria-label={`Preview guide ${guide.name}`}
        title="Preview"
        className="w-12 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-green-700 active:text-green-800 border-l border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Delete guide ${guide.name}`}
        title="Delete guide"
        className="w-12 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-600 active:text-red-700 border-l border-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}

function StatusPill({ published }: { published: boolean }) {
  return published ? (
    <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      Published
    </span>
  ) : (
    <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
      Draft
    </span>
  );
}

// ── New-guide dialog: name → POST → open the editor on the new id. ────────────
function CreateGuideDialog({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit() {
    const clean = name.trim();
    if (!clean) { setError('Give this guide a name.'); return; }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: clean }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false || !body?.id) {
        // 400 = a company must be chosen (multi-company manager); surface it verbatim.
        setError(body?.error || 'Could not create the guide.');
        return;
      }
      onCreated(Number(body.id), clean);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create the guide.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => { if (!submitting) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New guide"
        className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-white text-gray-900 px-4 py-3 rounded-t-2xl border-b border-gray-200">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Guide Library</p>
          <h2 className="text-base font-bold leading-tight">New guide</h2>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div>
            <label htmlFor="new-guide-name" className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
              Guide name
            </label>
            <input
              id="new-guide-name"
              ref={inputRef}
              type="text"
              value={name}
              maxLength={120}
              onChange={e => { setName(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              placeholder="e.g. Turn on the smoker"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">You&apos;ll add the steps next.</p>
          </div>

          {error && <p className="text-[12px] font-semibold text-red-600" role="alert">{error}</p>}
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="flex-[2] min-h-[44px] rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
