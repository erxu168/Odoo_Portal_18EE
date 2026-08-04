'use client';

/**
 * The jukebox search panel: debounced catalog search + tappable results with
 * door-policy badges. Refusal handling lives in the parent (toasts + queue).
 */
import { useEffect, useRef, useState } from 'react';

export interface SearchResult {
  videoId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  thumbnail: string | null;
  verdict: 'allow' | 'deny' | 'unsure' | null;
}

function fmtDuration(s: number | null): string {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const BADGE: Record<string, { text: string; cls: string }> = {
  allow: { text: 'PLAYS ✓', cls: 'bg-green-500/15 text-green-300' },
  deny: { text: 'BLOCKED', cls: 'bg-red-500/15 text-red-300' },
  unsure: { text: 'ASK MANAGER', cls: 'bg-amber-500/15 text-amber-300' },
};

export default function MusicSearch(props: {
  onPick: (r: SearchResult) => void;
  busyVideoId: string | null;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setError(null); return; }
    const seq = ++seqRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => ({}));
        if (seq !== seqRef.current) return; // stale response — a newer search is running
        if (!res.ok) { setResults(null); setError(data?.error ?? 'Search is not available right now.'); }
        else { setResults(data.results ?? []); setError(null); }
      } catch {
        if (seq === seqRef.current) { setResults(null); setError('Search is not available right now.'); }
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a song or artist…"
          className="w-full h-14 rounded-xl bg-[#1a1e26] border-[1.5px] border-[#262b35] focus:border-green-500 outline-none px-4 text-[15px] text-gray-100 placeholder-gray-500"
          aria-label="Search a song or artist"
        />
      </div>
      {error && <p className="px-4 py-2 text-[13px] text-amber-300">{error} — the radio keeps playing.</p>}
      {results !== null && (
        <div className="flex-1 overflow-y-auto px-2 pb-2" role="list">
          {searching && <p className="px-2 py-2 text-[12px] text-gray-500">Searching…</p>}
          {!searching && results.length === 0 && <p className="px-2 py-2 text-[13px] text-gray-500">Nothing found — try another spelling.</p>}
          {results.map((r) => {
            const badge = r.verdict ? BADGE[r.verdict] : null;
            const busy = props.busyVideoId === r.videoId;
            return (
              <button
                key={r.videoId}
                onClick={() => props.onPick(r)}
                disabled={busy}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl active:scale-[0.985] text-left border-b border-[#1a1e26] disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.thumbnail ? <img src={r.thumbnail} alt="" className="w-11 h-11 rounded-lg object-cover flex-none" /> : <div className="w-11 h-11 rounded-lg bg-[#233a2a] flex-none" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-gray-100 truncate">{r.title}</span>
                  <span className="block text-[12px] text-gray-400 truncate">{r.artist}</span>
                </span>
                <span className="text-[11px] text-gray-500 tabular-nums flex-none">{busy ? 'Checking…' : fmtDuration(r.durationSeconds)}</span>
                {badge && <span className={`text-[9px] font-extrabold tracking-wider px-2 py-1 rounded-full flex-none ${badge.cls}`}>{badge.text}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
