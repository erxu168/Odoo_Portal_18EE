'use client';

/**
 * One-tap subscribe / unsubscribe to web push notifications.
 * Renders nothing if the browser doesn't support service workers + push,
 * otherwise shows a compact card with a permission-aware button.
 *
 * Push messages are produced by the server (lib/push.ts) and delivered via
 * /public/sw.js. The component is purely about registering this device.
 */
import { useCallback, useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'busy';

export default function NotificationsToggle() {
  const [status, setStatus] = useState<Status>('busy');
  const [error,  setError]  = useState<string | null>(null);

  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;

  const refresh = useCallback(async () => {
    if (!supported) { setStatus('unsupported'); return; }
    if (Notification.permission === 'denied') { setStatus('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setStatus(sub ? 'subscribed' : 'unsubscribed');
    } catch {
      setStatus('unsubscribed');
    }
  }, [supported]);

  useEffect(() => { refresh(); }, [refresh]);

  async function enable() {
    setError(null); setStatus('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus(perm === 'denied' ? 'denied' : 'unsubscribed'); return; }

      const reg = (await navigator.serviceWorker.getRegistration('/'))
        || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) throw new Error('Push not configured on the server');
      const { key } = await keyRes.json();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // PushManager.subscribe's TS type wants a BufferSource backed by a true
        // ArrayBuffer; Uint8Array.buffer can widen to ArrayBufferLike, so cast.
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed to register subscription');
      setStatus('subscribed');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
      await refresh();
    }
  }

  async function disable() {
    setError(null); setStatus('busy');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('unsubscribed');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to disable');
      await refresh();
    }
  }

  if (status === 'unsupported') return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 mb-3 flex items-center gap-3">
      <span className="text-2xl">🔔</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">
          {status === 'subscribed' ? 'Notifications on' : 'Get notified'}
        </p>
        <p className="text-[11px] text-gray-500 leading-tight">
          {status === 'denied' && 'Blocked in browser settings — enable in your site permissions to use this.'}
          {status === 'unsubscribed' && 'Ping when a task is overdue or someone leaves a note.'}
          {status === 'subscribed' && 'You’ll get a buzz for overdue tasks and new notes.'}
          {status === 'busy' && 'Working…'}
        </p>
        {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
      </div>
      {status === 'unsubscribed' && (
        <button onClick={enable} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-orange-500 text-white hover:bg-orange-600">
          Turn on
        </button>
      )}
      {status === 'subscribed' && (
        <button onClick={disable} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-gray-600 border border-gray-300 hover:bg-gray-50">
          Turn off
        </button>
      )}
    </div>
  );
}
