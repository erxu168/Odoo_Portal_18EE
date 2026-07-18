'use client';

/**
 * Mounts the remote-restart heartbeat once, on every screen (via the root layout).
 * When a restart is scheduled it shows a full-screen "Updating…" notice for the brief
 * staggered delay before the device reloads/relaunches, so a kitchen screen going dark
 * mid-service reads as intentional.
 */
import { useEffect, useState } from 'react';
import { startRestartListener } from '@/lib/device-restart-client';

// Module-level guard: React StrictMode mounts effects twice in dev, and the layout can
// remount — we only ever want ONE heartbeat loop per tab.
let started = false;

export default function RestartListener() {
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (started) return;
    started = true;
    const stop = startRestartListener({
      onRestartScheduled: () => setUpdating(true),
    });
    return () => {
      started = false;
      stop();
    };
  }, []);

  if (!updating) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        background: 'rgba(17, 24, 39, 0.92)',
        color: '#fff',
        textAlign: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.25)',
          borderTopColor: '#fff',
          animation: 'kw-restart-spin 0.8s linear infinite',
        }}
      />
      <div style={{ fontSize: 17, fontWeight: 600 }}>Updating&hellip;</div>
      <div style={{ fontSize: 13, opacity: 0.75 }}>Loading the latest version. This screen will refresh in a moment.</div>
      <style>{'@keyframes kw-restart-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
