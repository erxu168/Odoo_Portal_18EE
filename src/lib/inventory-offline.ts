/**
 * Inventory Offline Store
 *
 * Browser-side IndexedDB layer for offline-capable counting.
 *
 * Two responsibilities:
 *   1. Cache session data (session, products, entries, flags, system qtys)
 *      so a session opened while online can keep working when the network
 *      drops mid-count.
 *   2. Queue mutations (POST/PUT/DELETE) that happen while offline and
 *      replay them when the network returns.
 *
 * Conflict model: per (session_id, product_id, count_location_id) line,
 * last-write-wins. The server upsert is idempotent so replaying a stale
 * mutation is safe. Legacy records without a spot are treated as spot 0.
 *
 * SSR safety: every public function checks `typeof window` and no-ops on
 * the server side.
 */

const DB_NAME = 'krawings_inventory_offline';
const DB_VERSION = 1;
const STORE_SESSION_CACHE = 'session_cache';
const STORE_QUEUE = 'mutation_queue';
const STORE_META = 'meta';

export interface CachedSessionData {
  session: any;
  products: any[];
  entries: any[];
  systemQtys: Record<number, number>;
  flags: Record<number, boolean>;
  crateSizes?: Record<number, number>;   // per-product pack size, for offline pack counting
  crateLabels?: Record<number, string>;  // per-product count-by label (crate/bunch/piece…)
  items?: any[];                         // frozen (product, spot) lines of the session
  spots?: any[];                         // frozen spot names for the badges
  cachedAt: number;
}

export interface QueuedMutation {
  id?: number;
  url: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  // Dedup key: when a newer mutation with the same key arrives we replace
  // the older one (e.g. count saves for the same product). Undefined =
  // never dedup (e.g. session submits).
  dedupKey?: string;
  createdAt: number;
  retries: number;
  lastError?: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSION_CACHE)) {
        db.createObjectStore(STORE_SESSION_CACHE, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const s = db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('dedupKey', 'dedupKey', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ===
// SESSION CACHE
// ===

export async function cacheSessionData(
  sessionId: number,
  data: Omit<CachedSessionData, 'cachedAt'>,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_SESSION_CACHE, 'readwrite', (store) => {
      store.put({ sessionId, ...data, cachedAt: Date.now() });
    });
  } catch (e) {
    console.warn('[offline] failed to cache session data:', e);
  }
}

export async function getCachedSessionData(
  sessionId: number,
): Promise<CachedSessionData | null> {
  if (!isBrowser()) return null;
  try {
    return await withStore(STORE_SESSION_CACHE, 'readonly', async (store) => {
      const row = await reqToPromise(store.get(sessionId));
      return row ? (row as CachedSessionData) : null;
    });
  } catch (e) {
    console.warn('[offline] failed to read cached session data:', e);
    return null;
  }
}

/**
 * Optimistic local update of cached entries — so the UI reflects an
 * offline count change after a reload-from-cache.
 */
export async function updateCachedEntry(
  sessionId: number,
  productId: number,
  patch: {
    counted_qty?: number | null;
    photos?: string[];
    uom?: string;
    crate_qty?: number | null;
    loose_qty?: number | null;
    units_per_crate?: number | null;
  },
  countLocationId: number = 0,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_SESSION_CACHE, 'readwrite', async (store) => {
      const row = await reqToPromise(store.get(sessionId)) as CachedSessionData | undefined;
      if (!row) return;
      const entries = Array.isArray(row.entries) ? [...row.entries] : [];
      const idx = entries.findIndex((e: any) => e.product_id === productId && (e.count_location_id ?? 0) === countLocationId);
      if (patch.counted_qty === null || patch.counted_qty === undefined && patch.photos === undefined) {
        // qty cleared → remove
        if (patch.counted_qty === null && idx >= 0) {
          entries.splice(idx, 1);
        }
      }
      if (patch.counted_qty !== null && patch.counted_qty !== undefined) {
        if (idx >= 0) {
          entries[idx] = {
            ...entries[idx],
            counted_qty: patch.counted_qty,
            uom: patch.uom ?? entries[idx].uom,
            photos: patch.photos ?? entries[idx].photos,
            crate_qty: patch.crate_qty !== undefined ? patch.crate_qty : entries[idx].crate_qty,
            loose_qty: patch.loose_qty !== undefined ? patch.loose_qty : entries[idx].loose_qty,
            units_per_crate: patch.units_per_crate !== undefined ? patch.units_per_crate : entries[idx].units_per_crate,
          };
        } else {
          entries.push({
            product_id: productId,
            count_location_id: countLocationId,
            counted_qty: patch.counted_qty,
            uom: patch.uom || 'Units',
            photos: patch.photos || [],
            crate_qty: patch.crate_qty ?? null,
            loose_qty: patch.loose_qty ?? null,
            units_per_crate: patch.units_per_crate ?? null,
          });
        }
      } else if (patch.photos !== undefined && idx >= 0) {
        entries[idx] = { ...entries[idx], photos: patch.photos };
      }
      store.put({ ...row, entries });
    });
  } catch (e) {
    console.warn('[offline] failed to update cached entry:', e);
  }
}

export async function clearCachedSession(sessionId: number): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_SESSION_CACHE, 'readwrite', (store) => {
      store.delete(sessionId);
    });
  } catch (e) {
    console.warn('[offline] failed to clear cached session:', e);
  }
}

// ===
// MUTATION QUEUE
// ===

export async function enqueueMutation(m: Omit<QueuedMutation, 'id' | 'createdAt' | 'retries'>): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_QUEUE, 'readwrite', async (store) => {
      // Dedup: if a queued mutation with the same dedupKey exists, replace it.
      if (m.dedupKey) {
        const idx = store.index('dedupKey');
        const existing = await reqToPromise(idx.getAll(m.dedupKey)) as QueuedMutation[];
        for (const row of existing) {
          if (row.id !== undefined) store.delete(row.id);
        }
      }
      store.add({ ...m, createdAt: Date.now(), retries: 0 });
    });
  } catch (e) {
    console.warn('[offline] failed to enqueue mutation:', e);
  }
}

export async function getQueue(): Promise<QueuedMutation[]> {
  if (!isBrowser()) return [];
  try {
    return await withStore(STORE_QUEUE, 'readonly', async (store) => {
      const rows = await reqToPromise(store.getAll()) as QueuedMutation[];
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    });
  } catch (e) {
    console.warn('[offline] failed to read queue:', e);
    return [];
  }
}

export async function getQueueSize(): Promise<number> {
  if (!isBrowser()) return 0;
  try {
    return await withStore(STORE_QUEUE, 'readonly', async (store) => {
      return await reqToPromise(store.count());
    });
  } catch {
    return 0;
  }
}

export async function removeFromQueue(id: number): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_QUEUE, 'readwrite', (store) => {
      store.delete(id);
    });
  } catch (e) {
    console.warn('[offline] failed to remove from queue:', e);
  }
}

export async function markQueueFailure(id: number, err: string): Promise<void> {
  if (!isBrowser()) return;
  try {
    await withStore(STORE_QUEUE, 'readwrite', async (store) => {
      const row = await reqToPromise(store.get(id)) as QueuedMutation | undefined;
      if (!row) return;
      store.put({ ...row, retries: (row.retries || 0) + 1, lastError: err });
    });
  } catch (e) {
    console.warn('[offline] failed to mark queue failure:', e);
  }
}

/**
 * Drop a queued mutation that has failed in a non-retryable way (e.g. 400/403/404).
 * Returns true on delete. Networking errors should NOT call this — they should
 * keep the mutation queued for the next sync.
 */
export async function dropQueuedMutation(id: number): Promise<void> {
  return removeFromQueue(id);
}
