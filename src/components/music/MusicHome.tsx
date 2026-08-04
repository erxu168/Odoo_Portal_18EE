'use client';

/**
 * Music module home (managers). Standard recipe: blue AppHeader, KPI chips,
 * white action cards. Staff never see this — they use the player tablet.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { KpiChip, KpiRow } from '@/components/ui/KpiChip';
import { ActionCard } from '@/components/ui/ActionCard';

export default function MusicHome() {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [today, setToday] = useState<number | null>(null);
  const [poolReady, setPoolReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([
        fetch('/api/music/history').then((x) => x.json()),
        fetch('/api/music/radio/refresh').then((x) => x.json()),
      ]);
      if (h?.ok) { setPending(h.pendingRequests ?? 0); setToday(h.today ?? 0); setError(null); }
      else setError(h?.error ?? 'Music is not available for you.');
      if (r?.ok) setPoolReady(Object.values(r.pools as Record<string, number>).some((d) => d > 0));
    } catch {
      setError('Could not load the music overview — check the connection.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="Music" title="WAJ Radio" subtitle={date} root />
      <div className="px-4 pt-4 max-w-3xl mx-auto">
        {error && <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[14px] px-4 py-3">{error}</p>}
        <KpiRow columns={3}>
          <KpiChip value={pending ?? '…'} label="Requests waiting" tone={pending ? 'danger' : 'default'} onClick={() => router.push('/music/requests')} />
          <KpiChip value={today ?? '…'} label="Songs today" onClick={() => router.push('/music/history')} />
          <KpiChip value={poolReady == null ? '…' : poolReady ? '✓' : '!'} label={poolReady === false ? 'Radio needs warm-up' : 'Radio healthy'} tone={poolReady === false ? 'danger' : 'default'} onClick={() => router.push('/music/settings')} />
        </KpiRow>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <ActionCard emoji="▶️" label="Player" subtitle="The screen on the speakers tablet" onClick={() => router.push('/music/player')} />
          <ActionCard emoji="🙋" label="Song Requests" subtitle="Approve or reject songs" badge={pending ? { value: pending, tone: 'danger' } : undefined} onClick={() => router.push('/music/requests')} />
          <ActionCard emoji="📜" label="Play History" subtitle="What played, picked by whom" onClick={() => router.push('/music/history')} />
          <ActionCard emoji="⚙️" label="Settings" subtitle="Player tablet · radio refresh" onClick={() => router.push('/music/settings')} />
        </div>
      </div>
    </div>
  );
}
