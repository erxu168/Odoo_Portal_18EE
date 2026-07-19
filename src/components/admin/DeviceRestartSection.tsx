'use client';

/**
 * Manager/admin remote restart of running app instances (KDS boards, kiosk tablets,
 * portal devices). Restart one device now, or the whole KDS fleet at once, and choose
 * which devices restart automatically after a deploy — all from your own device, no
 * need to walk over to the screen. A restart loads the latest version.
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

const SURFACE_LABEL: Record<string, string> = { kds: 'KDS', kiosk: 'Kiosk', portal: 'Portal' };

const PLATFORM: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iOS' };
function platformLabel(shell: string | null): string {
  if (!shell) return 'Device';
  return PLATFORM[shell.toLowerCase()] || shell.charAt(0).toUpperCase() + shell.slice(1);
}

/** Best human-readable name for a running screen, in priority order: manager-set name →
 *  provisioned tablet's name → "Portal · <person>" → the tablet's restaurant → platform +
 *  a short id (so two anonymous screens are still distinguishable). */
function displayName(d: DeviceRow): string {
  if (d.label?.trim()) return d.label.trim();
  if (d.tablet_name?.trim()) return d.tablet_name.trim();
  if (d.surface === 'portal' && d.user_name) return `Portal · ${d.user_name}`;
  if (d.tablet_label?.trim()) return d.tablet_label.trim();
  return `${platformLabel(d.shell)} · ${d.client_id.slice(-4)}`;
}

export default function DeviceRestartSection() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/devices', { cache: 'no-store' });
      if (!res.ok) {
        setDevices([]);
        return;
      }
      const d = await res.json();
      setDevices(d.devices || []);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // keep online/pending state fresh
    return () => clearInterval(t);
  }, [load]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function restartOne(d: DeviceRow) {
    const name = displayName(d);
    if (!window.confirm(`Restart ${name} now? The screen will reload to the latest version (a few seconds).`)) return;
    setBusy(d.client_id);
    setError(null);
    try {
      const res = await fetch('/api/admin/devices/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { type: 'client', clientId: d.client_id } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      flash(`Restart sent to ${name}.`);
      setDevices((prev) => (prev ? prev.map((x) => (x.client_id === d.client_id ? { ...x, pending: true } : x)) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function restartGroup(target: { type: 'surface'; surface: string } | { type: 'all' }, human: string) {
    if (!window.confirm(`Restart ${human}? Each screen reloads to the latest version, staggered over ~30s.`)) return;
    setBusy(`group:${human}`);
    setError(null);
    try {
      const res = await fetch('/api/admin/devices/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      flash(`Restart sent to ${j.recipients} device${j.recipients === 1 ? '' : 's'}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggleAuto(d: DeviceRow) {
    setBusy(d.client_id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(d.client_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_restart: !d.auto_restart }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      setDevices((prev) => (prev ? prev.map((x) => (x.client_id === d.client_id ? { ...x, auto_restart: !d.auto_restart } : x)) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function rename(d: DeviceRow) {
    const next = window.prompt('Name this screen so you can tell them apart (e.g. Kitchen KDS, Front phone):', d.label || '');
    if (next === null) return; // cancelled
    setBusy(d.client_id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(d.client_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      await load(); // re-fetch so the derived name reflects the saved value
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  if (devices === null) return null;

  const kdsCount = devices.filter((d) => d.surface === 'kds' && d.online).length;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-bold text-gray-900">Remote restart</h2>
        <button onClick={load} className="text-[12px] font-semibold text-gray-500 active:opacity-70" aria-label="Refresh device list">
          Refresh
        </button>
      </div>
      <p className="text-[13px] text-gray-500 mb-3">
        Restart a running screen to load the latest version — without walking over to it.
      </p>

      {notice && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-[12px]">{notice}</div>}
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[12px]">{error}</div>}

      {/* Group actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => restartGroup({ type: 'surface', surface: 'kds' }, `all KDS screens (${kdsCount} online)`)}
          disabled={busy !== null || kdsCount === 0}
          className="text-[13px] font-semibold px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 active:opacity-70 disabled:opacity-40"
        >
          Restart all KDS
        </button>
        <button
          onClick={() => restartGroup({ type: 'all' }, 'every connected screen')}
          disabled={busy !== null || devices.length === 0}
          className="text-[13px] font-semibold px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 active:opacity-70 disabled:opacity-40"
        >
          Restart all
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="text-[13px] text-gray-400 py-3">No devices have checked in yet.</div>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {devices.map((d) => (
            <div key={d.client_id} className="flex items-center gap-3 py-3">
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${d.online ? 'bg-green-500' : 'bg-gray-300'}`}
                aria-label={d.online ? 'Online' : 'Offline'}
              />
              <div className="min-w-0 flex-1">
                <button onClick={() => rename(d)} disabled={busy === d.client_id} className="flex items-center gap-1.5 max-w-full text-left active:opacity-70 disabled:opacity-50" aria-label="Rename this screen">
                  <span className="text-[14px] font-semibold text-gray-900 truncate">{displayName(d)}</span>
                  {d.surface && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex-shrink-0">{SURFACE_LABEL[d.surface] || d.surface}</span>
                  )}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 flex-shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
                <div className="text-[12px] text-gray-500 truncate">
                  {d.shell && d.shell !== 'web' ? `${d.shell} · ` : ''}
                  {d.pending ? 'restart pending · ' : ''}last seen {ago(d.last_seen)}
                </div>
              </div>

              {/* Auto-restart toggle */}
              <button
                onClick={() => toggleAuto(d)}
                disabled={busy === d.client_id}
                title="Restart automatically after a deploy"
                aria-label={d.auto_restart ? 'Auto-restart on' : 'Auto-restart off'}
                className={`relative w-[46px] h-[26px] rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${d.auto_restart ? 'bg-green-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all ${d.auto_restart ? 'left-[23px]' : 'left-[3px]'}`} />
              </button>
              <span className="text-[10px] text-gray-400 w-8 leading-tight">auto {d.auto_restart ? 'on' : 'off'}</span>

              <button
                onClick={() => restartOne(d)}
                disabled={busy !== null}
                className="text-[12px] font-semibold text-amber-700 active:opacity-70 disabled:opacity-40 flex-shrink-0"
              >
                Restart
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
