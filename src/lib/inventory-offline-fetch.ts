/**
 * Offline-aware fetch for the inventory module.
 *
 * Two helpers:
 *   - offlineSafeMutate(): try network; on network failure, queue and return
 *     a synthetic success so the UI keeps moving. On 4xx, fail loudly — the
 *     server is reachable and rejected the request.
 *   - drainQueue(): replay queued mutations in order. Called by useSyncQueue
 *     on reconnect.
 */
import {
  enqueueMutation,
  getQueue,
  removeFromQueue,
  markQueueFailure,
  type QueuedMutation,
} from './inventory-offline';

export interface MutateOpts {
  url: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  dedupKey?: string;
}

export interface MutateResult {
  ok: boolean;
  queued: boolean;
  status?: number;
  data?: any;
  error?: string;
}

/**
 * True when the error looks like a connectivity failure (not a server
 * rejection). We treat anything that didn't reach the server as queueable.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch throws TypeError on network failure
  return false;
}

export async function offlineSafeMutate(opts: MutateOpts): Promise<MutateResult> {
  const { url, method, body, dedupKey } = opts;
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  try {
    const res = await fetch(url, init);
    // 5xx → treat as transient, queue it
    if (res.status >= 500) {
      await enqueueMutation({ url, method, body, dedupKey });
      return { ok: false, queued: true, status: res.status, error: `Server ${res.status}` };
    }
    let data: any = null;
    try { data = await res.json(); } catch { /* empty body ok */ }
    if (!res.ok) {
      return { ok: false, queued: false, status: res.status, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, queued: false, status: res.status, data };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueMutation({ url, method, body, dedupKey });
      return { ok: false, queued: true, error: 'Offline — saved locally' };
    }
    // Unknown error — re-throw so caller decides
    throw err;
  }
}

/**
 * Drain the mutation queue. Replays in order. Stops on the first network
 * failure (no point continuing if we're still offline). Drops mutations
 * on 4xx (client errors are not transient).
 *
 * Returns the number of mutations successfully synced.
 */
export async function drainQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  const queue = await getQueue();
  let synced = 0;
  let failed = 0;

  for (const m of queue) {
    if (m.id === undefined) continue;
    try {
      const res = await fetch(m.url, {
        method: m.method,
        headers: m.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: m.body !== undefined ? JSON.stringify(m.body) : undefined,
      });
      if (res.status >= 500) {
        // Transient — leave in queue, stop draining
        await markQueueFailure(m.id, `Server ${res.status}`);
        const remaining = await getRemainingCount(queue, m.id);
        return { synced, failed, remaining };
      }
      if (!res.ok && res.status >= 400) {
        // Client error: drop it (replay won't help)
        let errMsg = `HTTP ${res.status}`;
        try { const j = await res.json(); errMsg = j?.error || errMsg; } catch { /* ignore */ }
        console.warn(`[offline] dropping queued mutation ${m.method} ${m.url}: ${errMsg}`);
        await removeFromQueue(m.id);
        failed++;
        continue;
      }
      await removeFromQueue(m.id);
      synced++;
    } catch (err) {
      if (isNetworkError(err)) {
        // Still offline — stop and leave the rest queued
        await markQueueFailure(m.id, 'Network failure');
        const remaining = await getRemainingCount(queue, m.id);
        return { synced, failed, remaining };
      }
      // Unexpected — log and skip
      console.error('[offline] unexpected drain error:', err);
      await markQueueFailure(m.id, String(err));
    }
  }

  return { synced, failed, remaining: 0 };
}

function getRemainingCount(originalQueue: QueuedMutation[], stoppedAtId: number): number {
  const idx = originalQueue.findIndex((m) => m.id === stoppedAtId);
  if (idx < 0) return 0;
  return originalQueue.length - idx;
}
