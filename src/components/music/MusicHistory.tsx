'use client';

/**
 * Play history — what played, whether staff picked it or the radio did,
 * and skips/failures with who pressed skip. Read-only.
 */
import { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Play {
  id: number; video_id: string; title: string; genre: string | null;
  source: string; outcome: string; error_code?: string | null;
  played_by?: string | null; played_at: string;
}

const OUTCOME: Record<string, { label: string; cls: string }> = {
  played: { label: '✓ Played', cls: 'bg-green-100 text-green-800' },
  skipped: { label: '⏭ Skipped', cls: 'bg-gray-100 text-gray-600' },
  failed: { label: '⚠️ Failed', cls: 'bg-amber-100 text-amber-800' },
};

export default function MusicHistory() {
  const [plays, setPlays] = useState<Play[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/music/history');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data?.error ?? 'Not available.'); return; }
        setPlays(data.plays ?? []);
      } catch { setError('Could not load the history — check the connection.'); }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="Music" title="Play History" subtitle="Latest first" backHref="/music" showBack />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        {error && <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[14px] px-4 py-3">{error}</p>}
        {!error && plays.length === 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 px-4 py-6 text-center text-[14px] text-gray-500">
            Nothing played yet — the list fills up once the music starts.
          </div>
        )}
        {plays.map((p) => {
          const o = OUTCOME[p.outcome] ?? OUTCOME.played;
          return (
            <div key={p.id} className="rounded-2xl bg-white border border-gray-200 px-4 py-3 mb-2 flex items-center gap-3">
              <span className={`text-[11px] font-bold px-2 py-1 rounded-full flex-none ${o.cls}`}>{o.label}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-gray-900 truncate">{p.title || p.video_id}</span>
                <span className="block text-[12px] text-gray-500 truncate">
                  {p.source === 'radio' ? '📻 Radio' : '🎵 Staff pick'}
                  {p.played_by ? ` · skipped by ${p.played_by}` : ''}
                  {' · '}{new Date(p.played_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
