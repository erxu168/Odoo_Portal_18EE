'use client';
/**
 * Inventory Floorplan — offline-after-first-open cache.
 *
 * Once a floor has been OPENED online, its manifest and raster live in
 * IndexedDB so the already-running app keeps working through a WiFi drop in
 * the basement. Deliberately NOT a service-worker cache: public/sw.js stays
 * push-only (a broad cache-first worker on shared tablets risks leaking one
 * user's company data to the next). Keys are scoped user/company; entries are
 * replaced only after a COMPLETE fresh payload arrived, and cleared on logout
 * or access loss. A cold PWA start from a QR while fully offline is out of
 * scope (v1, by spec).
 */
import type { FloorplanManifest } from './manifest';

const DB_NAME = 'kw-floorplan';
const STORE = 'floors';
const VERSION = 1;

interface CachedFloorplan {
  key: string;
  manifest: FloorplanManifest;
  rasters: Record<number, Blob>; // revisionId -> raster image
  cachedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(userId: number, companyId: number): string {
  return `${userId}:${companyId}`;
}

/** Store the manifest + every published floor's raster. All-or-nothing. */
export async function cacheFloorplan(userId: number, manifest: FloorplanManifest): Promise<void> {
  try {
    const rasters: Record<number, Blob> = {};
    for (const f of manifest.floors) {
      if (!f.revision) continue;
      const res = await fetch(f.revision.rasterUrl);
      if (!res.ok) return; // incomplete → keep the previous complete entry
      rasters[f.revision.id] = await res.blob();
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        key: cacheKey(userId, manifest.companyId),
        manifest,
        rasters,
        cachedAt: new Date().toISOString(),
      } satisfies CachedFloorplan);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // caching is best-effort — the online path never depends on it
  }
}

export interface OfflineFloorplan {
  manifest: FloorplanManifest;
  rasterUrls: Record<number, string>; // revisionId -> object URL
  cachedAt: string;
}

/** The last complete snapshot for this user+company, or null. */
export async function getCachedFloorplan(userId: number, companyId: number): Promise<OfflineFloorplan | null> {
  try {
    const db = await openDb();
    const row = await new Promise<CachedFloorplan | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(userId, companyId));
      req.onsuccess = () => resolve(req.result as CachedFloorplan | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!row) return null;
    const rasterUrls: Record<number, string> = {};
    for (const [revId, blob] of Object.entries(row.rasters)) {
      rasterUrls[Number(revId)] = URL.createObjectURL(blob);
    }
    return { manifest: row.manifest, rasterUrls, cachedAt: row.cachedAt };
  } catch {
    return null;
  }
}

/** Drop every cached floorplan of this user (logout / access loss). */
export async function clearFloorplanCache(userId: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(`${userId}:`)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best effort
  }
}
