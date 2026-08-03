'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import ManagerTabs from '../../_components/ManagerTabs';
import type { ReviewFeed, ReviewItem } from '@/lib/task-review';

/*
 * Photo Review — manager oversight screen. Staff still finish their own tasks;
 * this browses the proof photos they submitted and lets a manager FLAG one that
 * looks wrong. Flagging is oversight ONLY — the task stays done; the staff member
 * gets a phone push telling them it looked wrong. No approval gate.
 *
 *   GET /api/tasks/review?date=&staff=            -> ReviewFeed
 *   PUT /api/tasks/review/flag { line_id,flagged,reason }
 *   GET /api/tasks/review/photo/{attachmentId}    -> image bytes
 */

const DAY_PART_LABEL: Record<string, string> = { opening: 'Opening', mid_day: 'Mid-day', closing: 'Closing' };
type ToastState = { message: string; type: 'success' | 'error' | 'info' } | null;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}
function berlinTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function PhotoReviewPage() {
  const router = useRouter();

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

  const [date, setDate] = useState(berlinTodayStr());
  const [staffId, setStaffId] = useState<number | 'all'>('all');
  const [feed, setFeed] = useState<ReviewFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ item: ReviewItem; attId: number } | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (staffId !== 'all') qs.set('staff', String(staffId));
      const res = await fetch(`/api/tasks/review?${qs.toString()}`, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (token !== reqSeq.current) return;
      if (!res.ok) { setError(body?.error || 'Could not load the photo review.'); return; }
      setFeed(body as ReviewFeed);
    } catch (e: unknown) {
      if (token !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (token === reqSeq.current) setLoading(false);
    }
  }, [date, staffId]);

  useEffect(() => { if (authState === 'ok') load(); }, [authState, load]);

  // Distinct staff for the filter, from the *unfiltered* feed we currently show.
  const staffOptions = feed
    ? Array.from(new Map(feed.items.filter(i => i.completed_by_id).map(i => [i.completed_by_id as number, i.completed_by_name])).entries())
    : [];

  const isToday = date === berlinTodayStr();

  async function toggleFlag(item: ReviewItem) {
    if (busyLine) return;
    const willFlag = !item.flagged;
    let reason = item.flag_reason || 'Please redo this one.';
    if (willFlag) {
      const entered = window.prompt('Why is this wrong? (the staff member will see this)', reason);
      if (entered === null) return;                 // cancelled
      reason = entered.trim() || 'Please redo this one.';
    }
    setBusyLine(item.line_id);
    // Optimistic update (immediate feedback), reconciled by reload.
    setFeed(prev => prev && ({
      ...prev,
      items: prev.items.map(i => i.line_id === item.line_id ? { ...i, flagged: willFlag, flag_reason: willFlag ? reason : '' } : i),
      stats: {
        submitted: prev.stats.submitted,
        flagged: prev.stats.flagged + (willFlag ? 1 : -1),
        looks_good: prev.stats.looks_good + (willFlag ? -1 : 1),
      },
    }));
    try {
      const res = await fetch('/api/tasks/review/flag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ line_id: item.line_id, flagged: willFlag, reason: willFlag ? reason : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not update the flag.');
      setToast({ message: willFlag ? `Flagged — sent back to ${item.completed_by_name || 'the staff member'}.` : 'Flag cleared.', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Could not update the flag.', type: 'error' });
      load(); // revert the optimistic change from the server
    } finally {
      setBusyLine(null);
    }
  }

  if (authState !== 'ok') {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="TASK MANAGER" title="Photo review" showBack onBack={() => router.push('/tasks/manager')} />
        <div className="max-w-2xl mx-auto px-4 py-10 text-center text-sm text-gray-400">
          {authState === 'denied' ? 'Redirecting…' : 'Loading…'}
        </div>
      </div>
    );
  }

  const stats = feed?.stats;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="TASK MANAGER" title="Photo review" showBack onBack={() => router.push('/tasks/manager')} />
      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <p className="text-sm text-gray-500 mb-3 leading-snug">
          Spot-check the proof photos staff submitted. Tap a photo to enlarge; flag one that looks wrong and the staff member is told to redo it — the task stays done.
        </p>

        {/* Stat chips */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-white rounded-xl border border-gray-200 py-2.5 text-center">
            <div className="text-xl font-extrabold text-gray-800">{stats?.submitted ?? 0}</div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Submitted</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 py-2.5 text-center">
            <div className="text-xl font-extrabold text-green-600">{stats?.looks_good ?? 0}</div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Looks good</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 py-2.5 text-center">
            <div className="text-xl font-extrabold text-amber-600">{stats?.flagged ?? 0}</div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Flagged</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          <input
            type="date"
            value={date}
            max={berlinTodayStr()}
            onChange={e => setDate(e.target.value)}
            aria-label="Review date"
            className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white px-3 h-11 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={staffId}
            onChange={e => setStaffId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            aria-label="Filter by staff"
            className="rounded-lg border border-gray-200 bg-white px-3 h-11 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All staff</option>
            {staffOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-28 bg-gray-200 rounded-2xl animate-pulse" />)}</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-red-700 font-semibold">{error}</p>
            <button type="button" onClick={load} className="min-h-[44px] px-4 text-sm font-semibold text-blue-600 hover:text-blue-700">Try again</button>
          </div>
        ) : !feed || feed.items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-3xl mb-2">📸</p>
            <p className="font-semibold text-gray-700 text-sm">No photos {isToday ? 'yet today' : 'on this day'}</p>
            <p className="text-xs text-gray-400 mt-1">Proof photos staff submit will show up here.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {feed.items.map(item => (
              <ReviewCard
                key={item.line_id}
                item={item}
                busy={busyLine === item.line_id}
                canFlag={isToday}
                onEnlarge={(attId) => setLightbox({ item, attId })}
                onFlag={() => toggleFlag(item)}
              />
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center gap-4 p-6" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/tasks/review/photo/${lightbox.attId}`}
            alt={`Proof photo for ${lightbox.item.name}`}
            onClick={e => e.stopPropagation()}
            className="max-w-[88vw] max-h-[70vh] rounded-xl object-contain shadow-2xl"
          />
          <div className="text-white text-center text-sm">
            {lightbox.item.name}<br />
            <span className="opacity-70">{lightbox.item.completed_by_name}</span>
          </div>
          <button type="button" onClick={() => setLightbox(null)} className="px-5 py-2.5 rounded-xl bg-white text-gray-900 text-sm font-bold">Close</button>
        </div>
      )}

      <Toast message={toast?.message || ''} type={toast?.type} visible={!!toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function ReviewCard({
  item, busy, canFlag, onEnlarge, onFlag,
}: {
  item: ReviewItem;
  busy: boolean;
  canFlag: boolean;
  onEnlarge: (attId: number) => void;
  onFlag: () => void;
}) {
  const when = item.completed_at ? item.completed_at.slice(11, 16) : '';
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-3 ${item.flagged ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">{item.name}</p>
          <p className="text-[11.5px] text-gray-400">{DAY_PART_LABEL[item.day_part] ?? item.day_part}</p>
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
            <span className="w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">{initials(item.completed_by_name)}</span>
            {item.completed_by_name || 'Unknown'}{when ? ` · ${when}` : ''}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mt-2.5 overflow-x-auto">
        {item.attachments.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => onEnlarge(a.id)}
            aria-label={`Enlarge proof photo for ${item.name}`}
            className="relative w-[78px] h-[78px] flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/tasks/review/photo/${a.id}`} alt="" className="w-full h-full object-cover" loading="lazy" />
            <span className="absolute right-1 bottom-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">tap</span>
          </button>
        ))}
      </div>

      <div className="mt-2.5">
        <button
          type="button"
          onClick={onFlag}
          disabled={busy || !canFlag}
          title={!canFlag ? 'Past days are read-only' : undefined}
          className={`min-h-[38px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 border disabled:opacity-50 ${
            item.flagged ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600'
          }`}
        >
          {item.flagged ? '⚑ Flagged (tap to clear)' : '⚑ Flag as wrong'}
        </button>
      </div>

      {item.flagged && (
        <div className="mt-2 text-xs text-amber-800 bg-amber-100/70 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <b className="text-amber-700">⚑ Flagged</b> — {item.flag_reason || 'Please redo this one.'}{' '}
          <span className="opacity-70">Sent back to {item.completed_by_name || 'the staff member'}.</span>
        </div>
      )}
    </div>
  );
}
