'use client';

/**
 * Live devices — the screens currently running the portal, grouped so the list is
 * actually readable:
 *   • Your devices — managed screens (kitchen tablets, KDS boards, kiosks). Named,
 *     with Restart + auto-update, and a "Name this device" prompt for unnamed ones.
 *   • Point-of-sale — POS tills.
 *   • Staff phones — people signed in on their OWN phones/laptops. Collapsed and
 *     read-only: these aren't devices you manage, so there's no restart button.
 * A restart reloads the screen to the latest version, without walking over to it.
 */
import React, { useEffect, useState, useCallback } from 'react';

interface DeviceRow {
  client_id: string;
  label: string | null;
  shell: string | null;
  surface: string | null;
  native_relaunch: boolean;
  company_id: number | null;
  auto_restart: boolean;
  user_name: string | null;
  tablet_name: string | null;
  tablet_label: string | null;
  first_seen: string;
  last_seen: string;
  online: boolean;
  pending: boolean;
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const SURFACE_LABEL: Record<string, string> = { kds: 'Kitchen display', kiosk: 'Kiosk', portal: 'Tablet', pos: 'Point of sale' };
const SURFACE_EMOJI: Record<string, string> = { kds: '🖥️', kiosk: '⏱️', portal: '📱', pos: '🧾' };
const PLATFORM: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iOS', 'waj-till': 'Sunmi till' };
function platformLabel(shell: string | null): string {
  if (!shell) return 'Device';
  return PLATFORM[shell.toLowerCase()] || shell.charAt(0).toUpperCase() + shell.slice(1);
}

/** Which group a running screen belongs to. */
type Group = 'managed' | 'pos' | 'personal';
function groupOf(d: DeviceRow): Group {
  if (d.surface === 'pos') return 'pos';
  // A personal login = someone on the portal on their own device, NOT a provisioned tablet.
  if (d.surface === 'portal' && !d.tablet_name?.trim() && !d.tablet_label?.trim()) return 'personal';
  return 'managed';
}
/** A managed device is "named" once it has its own device name (not just the restaurant). */
function isUnnamed(d: DeviceRow): boolean {
  return !d.label?.trim() && !d.tablet_name?.trim();
}
/** Best human-readable name: manager-set name → provisioned tablet's name → the tablet's
 *  restaurant → platform + a short id (so two anonymous screens stay distinguishable). */
function deviceName(d: DeviceRow): string {
  if (d.label?.trim()) return d.label.trim();
  if (d.tablet_name?.trim()) return d.tablet_name.trim();
  if (d.tablet_label?.trim()) return d.tablet_label.trim();
  return `${platformLabel(d.shell)} · ${d.client_id.slice(-4)}`;
}

export default function DeviceRestartSection() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/devices', { cache: 'no-store' });
      if (!res.ok) { setDevices([]); return; }
      const d = await res.json();
      setDevices(d.devices || []);
    } catch { setDevices([]); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // keep online/pending state fresh
    return () => clearInterval(t);
  }, [load]);

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(null), 4000); }

  async function restartOne(d: DeviceRow) {
    const name = deviceName(d);
    if (!window.confirm(`Restart ${name} now? The screen reloads to the latest version (a few seconds).`)) return;
    setBusy(d.client_id); setError(null);
    try {
      const res = await fetch('/api/admin/devices/restart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { type: 'client', clientId: d.client_id } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      flash(`Restart sent to ${name}.`);
      setDevices((prev) => (prev ? prev.map((x) => (x.client_id === d.client_id ? { ...x, pending: true } : x)) : prev));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function restartGroup(target: { type: 'surface'; surface: string } | { type: 'all' }, human: string) {
    if (!window.confirm(`Restart ${human}? Each screen reloads to the latest version, staggered over ~30s.`)) return;
    setBusy(`group:${human}`); setError(null);
    try {
      const res = await fetch('/api/admin/devices/restart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      flash(`Restart sent to ${j.recipients} device${j.recipients === 1 ? '' : 's'}.`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function toggleAuto(d: DeviceRow) {
    setBusy(d.client_id); setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(d.client_id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_restart: !d.auto_restart }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      setDevices((prev) => (prev ? prev.map((x) => (x.client_id === d.client_id ? { ...x, auto_restart: !d.auto_restart } : x)) : prev));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  async function rename(d: DeviceRow) {
    const next = window.prompt('Name this device so you can tell them apart (e.g. Kitchen Pass tablet, Line KDS):', d.label || d.tablet_name || '');
    if (next === null) return;
    setBusy(d.client_id); setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(d.client_id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  if (devices === null) return null;

  const managed = devices.filter((d) => groupOf(d) === 'managed');
  const pos = devices.filter((d) => groupOf(d) === 'pos');
  const personal = devices.filter((d) => groupOf(d) === 'personal');
  const kdsCount = devices.filter((d) => d.surface === 'kds' && d.online).length;
  const managedOnline = managed.filter((d) => d.online).length;
  const peopleOnline = personal.filter((d) => d.online).length;

  const Pencil = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 flex-shrink-0"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
  );

  function deviceCard(d: DeviceRow) {
    const unnamed = isUnnamed(d);
    return (
      <div key={d.client_id} className={`bg-white border rounded-2xl overflow-hidden ${unnamed ? 'border-amber-200' : 'border-gray-200'}`}>
        <div className="p-3.5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-[19px] flex-shrink-0">{SURFACE_EMOJI[d.surface || ''] || '🖥️'}</div>
          <div className="min-w-0 flex-1">
            <button onClick={() => rename(d)} disabled={busy === d.client_id} className="flex items-center gap-1.5 max-w-full text-left active:opacity-70 disabled:opacity-50" aria-label="Rename this device">
              <span className="text-[14.5px] font-semibold text-gray-900 truncate">{deviceName(d)}</span>
              <Pencil />
            </button>
            <div className="text-[12px] text-gray-500 truncate mt-0.5">
              {SURFACE_LABEL[d.surface || ''] || 'Screen'}{d.shell && d.shell !== 'web' ? ` · ${platformLabel(d.shell)}` : ''}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold flex-shrink-0 ${d.online ? 'text-green-600' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${d.online ? 'bg-green-500' : 'bg-gray-300'}`} />
            {d.online ? 'Online' : ago(d.last_seen)}
          </span>
        </div>
        <div className="px-3.5 pb-3 flex items-center gap-2 flex-wrap">
          <button onClick={() => restartOne(d)} disabled={busy !== null}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 active:bg-gray-50 disabled:opacity-40">
            {d.pending ? 'Restart pending…' : 'Restart'}
          </button>
          <button onClick={() => toggleAuto(d)} disabled={busy === d.client_id}
            className="ml-auto inline-flex items-center gap-2 text-[11.5px] font-semibold text-gray-500 disabled:opacity-50" aria-label={d.auto_restart ? 'Auto-update on' : 'Auto-update off'} title="Reload automatically after an update">
            <span className={`relative w-[38px] h-[22px] rounded-full transition-colors ${d.auto_restart ? 'bg-green-600' : 'bg-gray-300'}`}>
              <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${d.auto_restart ? 'left-[19px]' : 'left-[3px]'}`} />
            </span>
            Auto-update
          </button>
        </div>
        {unnamed && (
          <div className="flex items-center gap-2 bg-amber-50 border-t border-amber-100 px-3.5 py-2 text-[12px] text-amber-800 font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
            This device hasn’t been named yet.
            <button onClick={() => rename(d)} disabled={busy === d.client_id} className="ml-auto text-[12px] font-semibold px-3 py-1 rounded-lg bg-[#2563EB] text-white active:opacity-80 disabled:opacity-50">Name it</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-bold text-gray-900">Live devices</h2>
        <button onClick={load} className="text-[12px] font-semibold text-gray-500 active:opacity-70" aria-label="Refresh device list">Refresh</button>
      </div>
      <p className="text-[13px] text-gray-500 mb-3">Screens running the portal right now. Restart one to load the latest version.</p>

      {notice && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-[12px]">{notice}</div>}
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[12px]">{error}</div>}

      {/* MANAGED */}
      <div className="flex items-center justify-between mb-2 mt-1">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-400">Your devices <span className="text-gray-300">· {managedOnline} online</span></h3>
        {managed.length > 0 && (
          <div className="flex gap-3">
            {kdsCount > 0 && (
              <button onClick={() => restartGroup({ type: 'surface', surface: 'kds' }, `all kitchen displays (${kdsCount} online)`)} disabled={busy !== null}
                className="text-[11.5px] font-semibold text-gray-500 active:opacity-70 disabled:opacity-40">Restart all KDS</button>
            )}
            <button onClick={() => restartGroup({ type: 'all' }, 'every managed screen')} disabled={busy !== null || managed.length === 0}
              className="text-[11.5px] font-semibold text-gray-500 active:opacity-70 disabled:opacity-40">Restart all</button>
          </div>
        )}
      </div>
      {managed.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 text-[13px] text-gray-500">No managed screens are online right now.</div>
      ) : (
        <div className="flex flex-col gap-2">{managed.map(deviceCard)}</div>
      )}

      {/* POS */}
      {pos.length > 0 && (
        <>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-400 mt-6 mb-2">Point-of-sale tills</h3>
          <div className="flex flex-col gap-2">{pos.map(deviceCard)}</div>
        </>
      )}

      {/* PERSONAL — collapsed, read-only */}
      {personal.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-400 mb-2">Not devices you manage</h3>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <button onClick={() => setShowPeople((v) => !v)} className="w-full flex items-center gap-3 p-3.5 text-left active:bg-gray-50">
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-[19px] flex-shrink-0">👥</div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-gray-900">Staff on their own phones</div>
                <div className="text-[12px] text-gray-500">{peopleOnline} using the portal now · {personal.length} personal login{personal.length === 1 ? '' : 's'}</div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-gray-400 transition-transform ${showPeople ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {showPeople && (
              <div className="border-t border-gray-100 px-3.5 py-2">
                <div className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 my-2">
                  These are staff signed in on their own phones and laptops — not devices you set up. Nothing to manage here, so no restart.
                </div>
                {personal.map((p) => (
                  <div key={p.client_id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0 text-[13.5px]">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.online ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="flex-1 font-medium text-gray-800 truncate">{p.user_name || deviceName(p)}</span>
                    <span className="text-[11.5px] text-gray-400 flex-shrink-0">{platformLabel(p.shell)} · {p.online ? 'online' : ago(p.last_seen)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
