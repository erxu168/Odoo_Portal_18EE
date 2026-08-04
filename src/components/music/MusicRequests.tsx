'use client';

/**
 * Song Requests — the manager's inbox (phone-friendly). Approving asks ONE
 * question: which genre shelf the song goes on (the radio balances shelves).
 * Every decision is permanent but changeable here later (audit kept).
 */
import { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface RequestRow {
  video_id: string; title: string; channel: string;
  status: 'pending' | 'approved' | 'denied';
  first_requested_by: string; last_requested_by: string; last_requested_at: string;
  request_count: number; resolved_by: string | null;
}

const GENRES: Array<{ id: string; emoji: string; label: string }> = [
  { id: 'hip_hop_rap', emoji: '🎤', label: 'Hip hop / Rap' },
  { id: 'reggae_dancehall_dub', emoji: '🇯🇲', label: 'Reggae / Dancehall' },
  { id: 'afrobeats_afro', emoji: '🥁', label: 'Afrobeats / Afro' },
  { id: 'rnb_soul_funk', emoji: '🎷', label: 'R&B / Soul / Funk' },
];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MusicRequests() {
  const [pending, setPending] = useState<RequestRow[]>([]);
  const [decided, setDecided] = useState<RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<RequestRow | null>(null);
  const [genre, setGenre] = useState<string>('reggae_dancehall_dub');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/music/requests');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? 'Not available.'); return; }
      setError(null);
      setPending(data.pending ?? []);
      setDecided((data.decided ?? []).slice(0, 30));
    } catch { setError('Could not load requests — check the connection.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const decide = useCallback(async (row: RequestRow, action: 'approve' | 'deny', g?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/music/requests/${encodeURIComponent(row.video_id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { action, genre: g } : { action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { flash(data?.error ?? 'That did not work — try again.'); return; }
      // Instant update — no refresh needed (binding rule).
      setPending((p) => p.filter((x) => x.video_id !== row.video_id));
      setDecided((d) => [{ ...row, status: action === 'approve' ? 'approved' : 'denied' }, ...d]);
      setSheetFor(null);
      flash(action === 'approve' ? '✓ Approved — plays from now on' : '✕ Rejected — stays blocked');
    } finally { setBusy(false); }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="Music" title="Song Requests" subtitle="Staff asked for these — you decide" backHref="/music" showBack />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        {error && <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[14px] px-4 py-3">{error}</p>}

        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Waiting for you · {pending.length}</p>
        {pending.length === 0 && !error && (
          <div className="rounded-2xl bg-white border border-gray-200 px-4 py-6 text-center text-[14px] text-gray-500">
            Nothing waiting. Refused songs staff ask for land here. 🌴
          </div>
        )}
        {pending.map((r) => (
          <div key={r.video_id} className="rounded-2xl bg-white border border-gray-200 p-4 mb-3">
            <p className="text-[15px] font-bold text-gray-900">{r.title}</p>
            <p className="text-[13px] text-gray-500">{r.channel}</p>
            <p className="text-[12px] text-gray-500 mt-1.5">
              Asked {r.request_count}× · last {fmtWhen(r.last_requested_at)} by {r.last_requested_by}
            </p>
            <a
              href={`https://www.youtube.com/watch?v=${r.video_id}`}
              target="_blank" rel="noreferrer"
              className="inline-block mt-2 text-[13px] font-bold text-blue-600"
            >▶ Listen on YouTube</a>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setSheetFor(r); setGenre('reggae_dancehall_dub'); }}
                className="flex-1 h-12 rounded-xl bg-green-600 text-white font-bold text-[15px] active:scale-[0.97]"
              >✓ Approve</button>
              <button
                onClick={() => decide(r, 'deny')}
                disabled={busy}
                className="flex-1 h-12 rounded-xl bg-white border-[1.5px] border-gray-200 text-gray-500 font-bold text-[15px] active:scale-[0.97] disabled:opacity-50"
              >✕ Reject</button>
            </div>
          </div>
        ))}

        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mt-6 mb-2">Decided earlier</p>
        {decided.length === 0 && <p className="text-[13px] text-gray-400">No decisions yet.</p>}
        {decided.map((r) => (
          <div key={`${r.video_id}_${r.status}`} className="rounded-2xl bg-white border border-gray-200 px-4 py-3 mb-2 flex items-center gap-3">
            <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full flex-none ${r.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {r.status === 'approved' ? '✓ Approved' : '✕ Rejected'}
            </span>
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-gray-900 truncate">{r.title}</span>
            <button onClick={() => { setSheetFor(r); setGenre('reggae_dancehall_dub'); }} className="text-[13px] font-bold text-gray-500 underline flex-none">Change</button>
          </div>
        ))}
      </div>

      {sheetFor && (
        <BottomSheet
          title={sheetFor.status === 'pending' ? 'Approve — which shelf does it go on?' : `Change decision — ${sheetFor.title}`}
          onClose={() => setSheetFor(null)}
          footer={
            <div className="space-y-2">
              <button
                onClick={() => decide(sheetFor, 'approve', genre)}
                disabled={busy}
                className="w-full h-12 rounded-xl bg-green-600 text-white font-bold text-[15px] disabled:opacity-50"
              >Approve as {GENRES.find((g) => g.id === genre)?.label}</button>
              {sheetFor.status !== 'pending' && (
                <button
                  onClick={() => decide(sheetFor, 'deny')}
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-white border-[1.5px] border-red-200 text-red-600 font-bold text-[15px] disabled:opacity-50"
                >✕ Keep it blocked</button>
              )}
            </div>
          }
        >
          <p className="text-[13px] text-gray-500 mb-3">The radio balances all four shelves, so every approved song needs a home.</p>
          {GENRES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGenre(g.id)}
              className={`w-full flex items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 mb-2 text-[15px] font-semibold text-left ${genre === g.id ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white'}`}
            >
              <span className="text-[20px]">{g.emoji}</span> {g.label}
              {genre === g.id && <span className="ml-auto text-green-600 font-extrabold">✓</span>}
            </button>
          ))}
        </BottomSheet>
      )}

      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[110] bg-gray-900 text-white text-[14px] font-semibold px-5 py-3 rounded-xl shadow-xl" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
