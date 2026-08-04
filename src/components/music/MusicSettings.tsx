'use client';

/**
 * Music settings: pin WHICH tablet is the player (only that device may drive
 * playback) and keep the radio pools warm. Every state shows its meaning and
 * the next step — no dead ends.
 */
import { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface DeviceOption { id: number; name: string | null; label: string | null; company_id: number }

const GENRE_LABEL: Record<string, string> = {
  hip_hop_rap: 'Hip hop / Rap', reggae_dancehall_dub: 'Reggae / Dancehall',
  afrobeats_afro: 'Afrobeats / Afro', rnb_soul_funk: 'R&B / Soul / Funk',
};

export default function MusicSettings() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [pools, setPools] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([
        fetch('/api/music/settings/player-device').then((x) => x.json()),
        fetch('/api/music/radio/refresh').then((x) => x.json()),
      ]);
      if (d?.ok) { setDevices(d.devices ?? []); setCurrent(d.current ?? null); setError(null); }
      else setError(d?.error ?? 'Not available.');
      if (p?.ok) setPools(p.pools ?? null);
    } catch { setError('Could not load settings — check the connection.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pin = useCallback(async (deviceId: number | null) => {
    setBusy(true);
    try {
      const res = await fetch('/api/music/settings/player-device', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { flash(data?.error ?? 'That did not work.'); return; }
      setCurrent(data.current ?? null);
      flash(deviceId == null ? 'Player tablet unpinned' : '✓ This tablet is now the player');
    } finally { setBusy(false); }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    flash('Refreshing the radio — this takes a minute…');
    try {
      const res = await fetch('/api/music/radio/refresh', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { flash(data?.error ?? 'Refresh did not work.'); return; }
      setPools(data.pools ?? null);
      flash(`✓ Radio refreshed (${data.refreshed} sources)`);
    } finally { setBusy(false); }
  }, []);

  const poolReady = pools && Object.values(pools).some((d) => d > 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="Music" title="Settings" subtitle="Player tablet & radio" backHref="/music" showBack />
      <div className="px-4 pt-4 max-w-2xl mx-auto space-y-5">
        {error && <p className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[14px] px-4 py-3">{error}</p>}

        <section className="rounded-2xl bg-white border border-gray-200 p-4">
          <h2 className="text-[15px] font-bold text-gray-900">Which tablet plays the music?</h2>
          <p className="text-[13px] text-gray-500 mt-1 mb-3">Only the pinned tablet can search, queue and skip. Everything else is locked out.</p>
          {devices.length === 0 && <p className="text-[13px] text-gray-500">No shared tablets yet — set one up under Shared Tablets first.</p>}
          {devices.map((d) => (
            <button
              key={d.id}
              onClick={() => pin(current === d.id ? null : d.id)}
              disabled={busy}
              className={`w-full flex items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 mb-2 text-left disabled:opacity-50 ${current === d.id ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}
            >
              <span className="text-[20px]">📱</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-gray-900 truncate">{d.name ?? d.label ?? `Tablet #${d.id}`}</span>
                <span className="block text-[12px] text-gray-500">Device #{d.id}</span>
              </span>
              {current === d.id && <span className="text-[12px] font-bold text-green-700 flex-none">▶ THE PLAYER</span>}
            </button>
          ))}
        </section>

        <section className="rounded-2xl bg-white border border-gray-200 p-4">
          <h2 className="text-[15px] font-bold text-gray-900">Radio shelves</h2>
          <p className="text-[13px] text-gray-500 mt-1 mb-3">
            {poolReady ? 'The radio has songs on every refreshed shelf.' : 'Empty — run the first warm-up so the radio can play when the queue is empty.'}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {Object.entries(pools ?? {}).map(([g, n]) => (
              <div key={g} className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2">
                <p className="text-[12px] text-gray-500">{GENRE_LABEL[g] ?? g}</p>
                <p className={`text-[18px] font-bold tabular-nums ${n === 0 ? 'text-red-600' : 'text-gray-900'}`}>{n} <span className="text-[11px] font-semibold text-gray-400">songs</span></p>
              </div>
            ))}
          </div>
          <button onClick={refresh} disabled={busy} className="w-full h-12 rounded-xl bg-green-600 text-white font-bold text-[15px] active:scale-[0.97] disabled:opacity-50">
            {poolReady ? 'Refresh the radio' : 'Warm up the radio'}
          </button>
        </section>
      </div>
      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[110] bg-gray-900 text-white text-[14px] font-semibold px-5 py-3 rounded-xl shadow-xl" role="status">{toast}</div>
      )}
    </div>
  );
}
