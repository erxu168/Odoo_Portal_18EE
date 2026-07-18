/**
 * Remote-restart client runtime (browser only).
 *
 * Mounted once via <RestartListener/> in the root layout, so it runs on every screen
 * including the public KDS board. It:
 *   - keeps a stable client id + issued secret in localStorage,
 *   - heartbeats POST /api/device/ping on a jittered ~10s loop (recursive setTimeout,
 *     so a slow request never overlaps the next),
 *   - when a pending restart command arrives, PERSISTS the command id before doing
 *     anything (the essential loop-guard) and then restarts once — native relaunch if
 *     the Capacitor plugin is present (Phase 2), else a cache-busting reload.
 *
 * Loop-safety: a command is only executed if its id is greater than the persisted
 * cursor AND the cursor write reads back correctly. If localStorage is unavailable we
 * refuse to auto-restart rather than risk a reload loop.
 */

const CLIENT_ID_KEY = 'kw_device_client_id';
const SECRET_KEY = 'kw_device_client_secret';
const CURSOR_KEY = 'kw_device_restart_cursor';

const BASE_INTERVAL_MS = 10_000;
const JITTER_MS = 3_000;
const MAX_BACKOFF_MS = 120_000;

interface CapacitorLike {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: { Relaunch?: { relaunch?: () => Promise<void> } };
}
function cap(): CapacitorLike | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
}

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === value; // read-back confirms it stuck
  } catch {
    return false;
  }
}

function mintClientId(): string {
  // crypto.randomUUID → 36 chars of [0-9a-f-], matches the server's id shape.
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'c' + Math.abs(Date.now() ^ (performance.now() * 1000)).toString(36) + Math.random().toString(36).slice(2, 10);
  lsSet(CLIENT_ID_KEY, id);
  return id;
}

function ensureClientId(): string {
  const id = lsGet(CLIENT_ID_KEY);
  if (id && /^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
  return mintClientId();
}

function detectSurface(): string {
  if (typeof window === 'undefined') return 'portal';
  const p = window.location.pathname;
  if (p.startsWith('/kds')) return 'kds';
  if (p.startsWith('/kiosk')) return 'kiosk';
  return 'portal';
}

function detectShell(): string {
  const c = cap();
  const plat = c?.getPlatform?.();
  return plat && plat !== 'web' ? plat : 'web';
}

function nativeRelaunchAvailable(): boolean {
  const c = cap();
  return !!(c?.isNativePlatform?.() && c.isPluginAvailable?.('Relaunch'));
}

export interface RestartListenerOptions {
  /** Called when a restart has been scheduled (device is about to reload/relaunch). */
  onRestartScheduled?: (delayMs: number) => void;
}

export function startRestartListener(opts: RestartListenerOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {};

  let clientId = ensureClientId();
  let cursor = Number(lsGet(CURSOR_KEY) || '0') || 0;
  let stopped = false;
  let restarting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = BASE_INTERVAL_MS;

  function scheduleNext(ms: number) {
    if (stopped || restarting) return;
    if (timer) clearTimeout(timer);
    const jitter = Math.floor((Math.random() - 0.5) * 2 * JITTER_MS);
    timer = setTimeout(poll, Math.max(2_000, ms + jitter));
  }

  async function doRestart(commandId: number) {
    // Native relaunch first (Phase 2); fall back to a cache-busting reload that keeps
    // the current path. We do NOT touch the service worker — it only handles push and
    // does not cache the app shell; the `no-store` HTML policy + content-hashed chunks
    // already surface the new build on reload.
    if (nativeRelaunchAvailable()) {
      try {
        await cap()!.Plugins!.Relaunch!.relaunch!();
        return;
      } catch {
        /* fall through to web reload */
      }
    }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('_r', String(commandId));
      window.location.replace(u.toString());
    } catch {
      window.location.reload();
    }
  }

  function scheduleRestart(commandId: number, delayMs: number) {
    // Persist BEFORE executing so a reload can't replay this command. Refuse if the
    // write can't be confirmed — better to not restart than to loop.
    if (!lsSet(CURSOR_KEY, String(commandId))) return;
    cursor = commandId;
    restarting = true;
    if (timer) clearTimeout(timer);
    opts.onRestartScheduled?.(delayMs);
    window.setTimeout(() => void doRestart(commandId), Math.max(0, delayMs));
  }

  async function poll() {
    if (stopped || restarting) return;
    const sentSecret = lsGet(SECRET_KEY) || '';
    try {
      const res = await fetch('/api/device/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          clientId,
          secret: sentSecret || undefined,
          shell: detectShell(),
          surface: detectSurface(),
          nativeRelaunch: nativeRelaunchAvailable(),
          lastExecutedCommandId: cursor,
        }),
      });

      if (res.status === 403) {
        // Distinguish a rejected credential from a same-origin block: only a
        // bad_credential means THIS id is unusable. Re-mint the in-memory id (not just
        // localStorage) so we actually re-register instead of 403-looping forever.
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (j.error === 'bad_credential') {
          const lsId = lsGet(CLIENT_ID_KEY);
          if (lsId && lsId !== clientId && /^[A-Za-z0-9_-]{8,64}$/.test(lsId)) {
            // Another tab already re-registered under a NEW id — adopt it (and its
            // secret) rather than minting a competing identity. This is what stops a
            // cross-tab remint ping-pong (each tab holds its own in-memory id).
            clientId = lsId;
          } else {
            const current = lsGet(SECRET_KEY) || '';
            if (!current || current === sentSecret) {
              // Our secret is gone or stale — abandon this identity and re-register.
              // Minting writes the new id to localStorage, so other tabs adopt it above.
              try {
                window.localStorage.removeItem(SECRET_KEY);
              } catch {
                /* ignore */
              }
              clientId = mintClientId();
            }
            // else: another tab just stored a fresh secret for our id — retry with it.
          }
        }
        backoff = BASE_INTERVAL_MS;
        scheduleNext(800);
        return;
      }

      if (res.ok) {
        const d = (await res.json()) as {
          issuedSecret?: string;
          restart?: { commandId: number; delayMs: number } | null;
        };
        if (d.issuedSecret) lsSet(SECRET_KEY, d.issuedSecret);
        backoff = BASE_INTERVAL_MS;
        if (d.restart && d.restart.commandId > cursor) {
          scheduleRestart(d.restart.commandId, d.restart.delayMs);
          return;
        }
      } else {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    } catch {
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
    scheduleNext(backoff);
  }

  function pokeNow() {
    if (stopped || restarting) return;
    backoff = BASE_INTERVAL_MS;
    scheduleNext(500);
  }
  const onOnline = () => pokeNow();
  const onVisible = () => {
    if (document.visibilityState === 'visible') pokeNow();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  // First heartbeat shortly after mount (let the page settle).
  timer = setTimeout(poll, 1_500);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
