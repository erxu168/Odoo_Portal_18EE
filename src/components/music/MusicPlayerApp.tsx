'use client';

/**
 * WAJ Radio — the kiosk screen on the Sunmi at the speakers.
 *
 * Layout law (YouTube rules, spec §2a): the video pane is FIXED and never
 * covered — the search/queue panel scrolls internally, so an open Android
 * keyboard squeezes the panel, not the player. The server owns all playback
 * state; this screen renders it and reports IFrame events with the version it
 * observed (duplicates become no-ops server-side).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import YouTubeIFramePlayer from '@/components/music/YouTubeIFramePlayer';
import MusicSearch, { type SearchResult } from '@/components/music/MusicSearch';

interface Playback {
  version: number; video_id: string | null; source: 'manual' | 'radio' | null;
  genre: string | null; title: string | null; channel: string | null;
  state: 'playing' | 'idle';
}
interface QueueItem { id: number; video_id: string; title: string; channel: string; added_by_name: string }

const GENRE_LABEL: Record<string, string> = {
  hip_hop_rap: 'Hip hop / Rap', reggae_dancehall_dub: 'Reggae / Dancehall',
  afrobeats_afro: 'Afrobeats / Afro', rnb_soul_funk: 'R&B / Soul / Funk',
};

type Toast = { kind: 'ok' | 'no' | 'warn'; text: string };

async function post(url: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export default function MusicPlayerApp() {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [poolReady, setPoolReady] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null); // device/setup problem
  const [splash, setSplash] = useState(true);                  // web fallback / autoplay recovery
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);
  const kickRef = useRef<() => void>(() => undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(0);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const applyState = useCallback((data: Record<string, unknown>) => {
    const pb = (data.playback ?? null) as Playback | null;
    if (pb && pb.version >= versionRef.current) {
      versionRef.current = pb.version;
      setPlayback(pb);
    } else if (!pb) {
      setPlayback(null);
    }
    if (Array.isArray(data.queue)) setQueue(data.queue as QueueItem[]);
    if (typeof data.poolReady === 'boolean') setPoolReady(data.poolReady);
  }, []);

  // Boot: try to start (or resume) playback; surface setup problems plainly.
  const boot = useCallback(async () => {
    const { status, data } = await post('/api/music/player/start');
    if (status === 409 || status === 403 || status === 401) {
      setBlocked(String(data.error ?? 'This tablet is not set up as the WAJ Radio player.'));
      return;
    }
    setBlocked(null);
    applyState(data);
  }, [applyState]);

  useEffect(() => { boot(); }, [boot]);

  // 15s state poll — picks up queue changes and repairs drift.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/music/player/state');
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok) { setBlocked(null); applyState(data); }
        else if (res.status === 403 || res.status === 409) setBlocked(String(data.error ?? 'Not the player tablet.'));
      } catch { /* offline — keep playing what we have */ }
    }, 15_000);
    return () => clearInterval(t);
  }, [applyState]);

  // Screen wake lock (PWA path) — re-acquire when the tab becomes visible again.
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release?: () => Promise<void> }> } }).wakeLock;
        if (wl) lock = await wl.request('screen');
      } catch { /* not fatal — kiosk apps keep the screen on themselves */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);

  const advance = useCallback(async (event: 'ended' | 'error', errorCode: string | undefined, videoId: string | null) => {
    // videoId comes from the PLAYER (the track that emitted the event) — the
    // server drops the event if that track is no longer the current one.
    const { data } = await post('/api/music/player/advance', { version: versionRef.current, event, errorCode, videoId: videoId ?? undefined });
    applyState(data);
  }, [applyState]);

  const onPick = useCallback(async (r: SearchResult) => {
    setBusyVideoId(r.videoId);
    try {
      const key = `${r.videoId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const { status, data } = await post('/api/music/queue', { videoId: r.videoId, idempotencyKey: key });
      if (status === 200) {
        showToast({ kind: 'ok', text: '✓ Added to queue' });
        if (Array.isArray(data.queue)) setQueue(data.queue as QueueItem[]);
        if (!playback || playback.state !== 'playing') boot(); // first song of the day
      } else if (data.requested) {
        showToast({ kind: 'warn', text: String(data.message ?? 'Sent to the manager to review.') });
      } else if (data.refused) {
        showToast({ kind: 'no', text: String(data.message ?? 'Not the What A Jerk vibe 🌴') });
      } else {
        showToast({ kind: 'warn', text: String(data.error ?? data.message ?? 'Try again in a minute.') });
      }
    } finally {
      setBusyVideoId(null);
    }
  }, [playback, boot, showToast]);

  const onSkip = useCallback(async () => {
    const { status, data } = await post('/api/music/player/skip', { version: versionRef.current, videoId: playback?.video_id ?? undefined });
    if (status === 200) { applyState(data); showToast({ kind: 'ok', text: '⏭ Skipped' }); }
    else showToast({ kind: 'warn', text: String(data.error ?? 'Could not skip.') });
  }, [applyState, showToast, playback]);

  if (blocked) {
    return (
      <main className="fixed inset-0 bg-[#0F1115] text-gray-100 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl">🌴🎵</div>
          <h1 className="text-xl font-bold">WAJ Radio can&rsquo;t play here yet</h1>
          <p className="text-[15px] text-gray-400">{blocked}</p>
          <button onClick={boot} className="h-12 px-6 rounded-full bg-green-600 font-bold active:scale-95">Try again</button>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 bg-[#0F1115] text-gray-100 flex flex-col lg:flex-row overflow-hidden">
      {/* ── Video pane: fixed, never covered ── */}
      <section className="lg:flex-[3] flex flex-col min-w-0 border-b lg:border-b-0 lg:border-r border-[#1d2129]">
        <div className="relative flex-1 min-h-[270px] bg-black">
          <YouTubeIFramePlayer
            videoId={playback?.video_id ?? null}
            onEnded={(vid) => advance('ended', undefined, vid)}
            onError={(code, vid) => advance('error', `e${code}`, vid)}
            onAutoplayBlocked={() => setSplash(true)}
            onPlaying={() => setSplash(false)}
            registerKick={(k) => { kickRef.current = k; }}
          />
        </div>
        <div className="px-4 py-3 bg-[#12151b]">
          {playback?.state === 'playing' ? (
            <>
              <p className="text-[16px] font-bold truncate">{playback.title}</p>
              <p className="text-[13px] text-gray-400 truncate">{playback.channel}</p>
              <p className="mt-1.5 flex gap-2 text-[10px] font-bold uppercase tracking-wider">
                <span className="px-2.5 py-1 rounded-full border border-green-900 text-green-300">
                  {playback.source === 'radio' ? '📻 WAJ Radio' : '🎵 Staff pick'}
                </span>
                {playback.genre && (
                  <span className="px-2.5 py-1 rounded-full border border-blue-900 text-blue-300">{GENRE_LABEL[playback.genre] ?? playback.genre}</span>
                )}
              </p>
            </>
          ) : (
            <p className="text-[14px] text-gray-400">
              {poolReady ? 'Nothing playing — search a song or wait for the radio.' : 'Radio needs a first warm-up — a manager opens Music → Settings → Refresh radio.'}
            </p>
          )}
        </div>
      </section>

      {/* ── Panel: search + queue (scrolls internally) ── */}
      <section className="lg:flex-[2] flex flex-col min-h-0 bg-[#12151b]">
        <MusicSearch onPick={onPick} busyVideoId={busyVideoId} />
        <div className="flex-1 overflow-y-auto px-4 pb-2 min-h-[80px]">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 pt-2 pb-1">Up next · {queue.length}</p>
          {queue.length === 0 && <p className="text-[13px] text-gray-500">Queue is empty — the radio picks the music.</p>}
          {queue.map((q, i) => (
            <div key={q.id} className="flex items-center gap-3 py-2 border-b border-[#1a1e26]">
              <span className="text-[10px] font-extrabold text-gray-600 w-4 text-center">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold truncate">{q.title}</span>
                <span className="block text-[12px] text-gray-400 truncate">Picked by {q.added_by_name}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="p-3">
          <button
            onClick={onSkip}
            disabled={playback?.state !== 'playing'}
            className="w-full h-14 rounded-xl border-[1.5px] border-[#2a2f38] bg-[#1a1e26] font-bold text-[15px] active:scale-[0.97] disabled:opacity-40"
          >
            ⏭&nbsp; Skip this song
          </button>
        </div>
      </section>

      {/* ── Start splash (web fallback / autoplay recovery) — sits over the WHOLE page, shown only while nothing plays ── */}
      {splash && (
        <div className="absolute inset-0 z-20 bg-[#0a0c10]/95 flex flex-col items-center justify-center gap-5 text-center p-6">
          <div className="text-5xl">🌴🎵</div>
          <button
            onClick={() => { setSplash(false); kickRef.current(); boot(); }}
            className="h-16 px-10 rounded-full bg-green-600 text-[18px] font-extrabold shadow-lg active:scale-95"
          >
            ▶&nbsp; Start WAJ Radio
          </button>
          <p className="max-w-sm text-[13px] text-gray-400">One tap starts the music. The app version starts by itself.</p>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={`absolute left-1/2 bottom-5 -translate-x-1/2 z-30 px-5 py-3 rounded-xl text-[14px] font-semibold shadow-xl border bg-[#1d222b] ${
            toast.kind === 'ok' ? 'border-green-800' : toast.kind === 'no' ? 'border-red-900' : 'border-amber-800'
          }`}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </main>
  );
}
