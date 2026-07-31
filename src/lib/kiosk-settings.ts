/**
 * Device-local settings for the Time Clock kiosk, stored in localStorage so a
 * tablet stays configured across reloads/restarts. Managers set these from the
 * on-kiosk settings screen (gated by portal login). The old ?company= URL param
 * still works as a first-time / override fallback when no company has been saved.
 */

export interface KioskSettings {
  companyId: number | null;
  companyName: string;
  tabletName: string;
  fullscreenLock: boolean;
  idleSeconds: number;
  /**
   * Seconds of no touching before the name list is hidden again behind the welcome
   * screen. Distinct from idleSeconds, which is the much shorter dwell on the "clocked
   * in" confirmation — the two are easy to confuse and must not share a value: 5s is
   * right for reading a confirmation and far too short to find your name in a list.
   */
  hideNamesSeconds: number;
  sound: boolean;
  showWorkingNow: boolean;
}

export const KIOSK_SETTINGS_KEY = 'kw_kiosk_settings';

export const KIOSK_DEFAULTS: KioskSettings = {
  companyId: null,
  companyName: '',
  tabletName: '',
  fullscreenLock: true,
  idleSeconds: 5,
  hideNamesSeconds: 60,
  sound: false,
  showWorkingNow: true,
};

export const IDLE_MIN = 3;
export const IDLE_MAX = 30;

/**
 * 10s to 5min. The floor is not 0: "never hide" has to be impossible, because the whole
 * point of the welcome screen is that a roster left on a tablet by the door is not on
 * display all day. A manager who wants it effectively off can still choose 5 minutes.
 */
export const HIDE_NAMES_MIN = 10;
export const HIDE_NAMES_MAX = 300;
export const HIDE_NAMES_STEP = 5;

function clampIdle(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : KIOSK_DEFAULTS.idleSeconds;
  return Math.min(IDLE_MAX, Math.max(IDLE_MIN, v));
}

/** Its own clamp — clampIdle's 3-30s range would silently crush this to 30s. */
function clampHideNames(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : KIOSK_DEFAULTS.hideNamesSeconds;
  return Math.min(HIDE_NAMES_MAX, Math.max(HIDE_NAMES_MIN, v));
}

/** "45 seconds" / "1 minute" / "2 min 30s" — a manager should not have to divide by 60. */
export function formatHideNames(seconds: number): string {
  const s = clampHideNames(seconds);
  if (s < 60) return `${s} seconds`;
  const mins = Math.floor(s / 60);
  const rest = s % 60;
  const minPart = mins === 1 ? '1 minute' : `${mins} minutes`;
  return rest ? `${minPart} ${rest}s` : minPart;
}

function companyFromUrl(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('company');
    const c = raw ? parseInt(raw, 10) : NaN;
    return Number.isInteger(c) && c > 0 ? c : null;
  } catch {
    return null;
  }
}

/**
 * Read the tablet's settings, merging stored values over defaults. When no
 * company has been saved yet, falls back to the ?company= URL param. Never throws
 * (localStorage can be unavailable in private mode / disabled).
 */
export function loadKioskSettings(): KioskSettings {
  let stored: Partial<KioskSettings> = {};
  try {
    const raw = window.localStorage.getItem(KIOSK_SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // `JSON.parse` succeeds on "null", "42" and "[]" — only the object case is usable.
    // Spreading a null is harmless; reading `stored.idleSeconds` off it is what throws,
    // where this function promises never to. A tablet that cannot read its settings must
    // fall back to defaults, not fail to start.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      stored = parsed as Partial<KioskSettings>;
    }
  } catch {
    /* fall back to defaults */
  }
  const merged: KioskSettings = {
    ...KIOSK_DEFAULTS,
    ...stored,
    idleSeconds: clampIdle(stored.idleSeconds),
    hideNamesSeconds: clampHideNames(stored.hideNamesSeconds),
  };
  if (!merged.companyId || merged.companyId <= 0) {
    merged.companyId = companyFromUrl();
  }
  return merged;
}

/** Persist a partial update and return the full new settings. Never throws. */
export function saveKioskSettings(patch: Partial<KioskSettings>): KioskSettings {
  const next: KioskSettings = { ...loadKioskSettings(), ...patch };
  next.idleSeconds = clampIdle(next.idleSeconds);
  next.hideNamesSeconds = clampHideNames(next.hideNamesSeconds);
  try {
    window.localStorage.setItem(KIOSK_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* if we can't persist, the caller still gets the in-memory value */
  }
  return next;
}

/** True when localStorage is usable — so the UI can warn if settings won't stick. */
export function kioskStorageAvailable(): boolean {
  try {
    const k = '__kw_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}
