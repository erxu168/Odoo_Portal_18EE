'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getQueueSize } from '@/lib/inventory-offline';
import { drainQueue } from '@/lib/inventory-offline-fetch';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Track the offline mutation queue and replay it whenever the browser
 * comes back online.
 *
 * Exposes:
 *   - pending: how many items are queued right now (refreshed after writes/syncs)
 *   - syncing: a drain is in progress
 *   - lastSync: { syncedCount, failedCount, at }  — null until first drain
 *   - refresh(): caller can ask to re-read the queue size after enqueueing
 *   - syncNow(): force a drain attempt (no-op if offline)
 *
 * Use it once in the app shell — multiple instances would race the drain.
 */
export interface SyncState {
  pending: number;
  syncing: boolean;
  online: boolean;
  lastSync: { synced: number; failed: number; at: number } | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export function useSyncQueue(): SyncState {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncState['lastSync']>(null);
  const draining = useRef(false);

  const refresh = useCallback(async () => {
    const n = await getQueueSize();
    setPending(n);
  }, []);

  const syncNow = useCallback(async () => {
    if (draining.current) return;
    if (!navigator.onLine) return;
    draining.current = true;
    setSyncing(true);
    try {
      const result = await drainQueue();
      setLastSync({ synced: result.synced, failed: result.failed, at: Date.now() });
      setPending(result.remaining);
    } catch (e) {
      console.error('[offline] drain error:', e);
    } finally {
      draining.current = false;
      setSyncing(false);
    }
  }, []);

  // Initial read of queue size
  useEffect(() => { void refresh(); }, [refresh]);

  // Re-drain whenever we transition to online (and on first mount if online)
  useEffect(() => {
    if (online) void syncNow();
  }, [online, syncNow]);

  // Poll queue size in the background so the badge updates if other code
  // enqueues a mutation. Cheap (count() op only).
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return { pending, syncing, online, lastSync, refresh, syncNow };
}
