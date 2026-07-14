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
  sound: false,
  showWorkingNow: true,
};

export const IDLE_MIN = 3;
export const IDLE_MAX = 30;

function clampIdle(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : KIOSK_DEFAULTS.idleSeconds;
  return Math.min(IDLE_MAX, Math.max(IDLE_MIN, v));
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
    if (raw) stored = JSON.parse(raw) as Partial<KioskSettings>;
  } catch {
    /* fall back to defaults */
  }
  const merged: KioskSettings = {
    ...KIOSK_DEFAULTS,
    ...stored,
    idleSeconds: clampIdle(stored.idleSeconds),
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
