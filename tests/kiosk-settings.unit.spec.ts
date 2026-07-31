import { test, expect } from '@playwright/test';
import {
  formatHideNames,
  loadKioskSettings,
  KIOSK_SETTINGS_KEY,
  HIDE_NAMES_MIN,
  HIDE_NAMES_MAX,
  HIDE_NAMES_STEP,
  IDLE_MIN,
  IDLE_MAX,
  KIOSK_DEFAULTS,
} from '../src/lib/kiosk-settings';

/** Minimal localStorage + window so the settings module can run outside a browser. */
function stubStorage(stored: string | null): void {
  const map = new Map<string, string>();
  if (stored !== null) map.set(KIOSK_SETTINGS_KEY, stored);
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    location: { search: '' },
  };
}

/**
 * "Hide the names" is how long the staff roster may sit on the tablet before the welcome
 * screen takes the screen back. It is a SEPARATE setting from `idleSeconds` (the dwell on
 * the "clocked in" confirmation) and the two must never be conflated: idleSeconds tops out
 * at 30s, which would yank the name list away while someone is still looking for their name.
 */

test('the two timeouts are genuinely different settings, not one value reused', () => {
  // Their ranges overlap (3-30s vs 10-300s) and that is fine — they are different
  // questions, not disjoint ones. What must hold is that hiding the names can be set far
  // longer than a confirmation ever needs to sit, and that the shipped defaults differ.
  expect(HIDE_NAMES_MAX).toBeGreaterThan(IDLE_MAX);
  expect(KIOSK_DEFAULTS.idleSeconds).toBeLessThan(KIOSK_DEFAULTS.hideNamesSeconds);
});

test('the range cannot be set to "never hide"', () => {
  // The welcome screen exists so a roster is not on display all day. A manager may make it
  // long, but not infinite, and not zero.
  expect(HIDE_NAMES_MIN).toBeGreaterThan(0);
  expect(HIDE_NAMES_MAX).toBe(300);
  expect(IDLE_MIN).toBeGreaterThan(0);
});

test('the slider only lands on values the clamp accepts', () => {
  // A step that does not divide the span leaves the top of the slider unreachable.
  expect((HIDE_NAMES_MAX - HIDE_NAMES_MIN) % HIDE_NAMES_STEP).toBe(0);
  expect(KIOSK_DEFAULTS.hideNamesSeconds).toBeGreaterThanOrEqual(HIDE_NAMES_MIN);
  expect(KIOSK_DEFAULTS.hideNamesSeconds).toBeLessThanOrEqual(HIDE_NAMES_MAX);
  expect((KIOSK_DEFAULTS.hideNamesSeconds - HIDE_NAMES_MIN) % HIDE_NAMES_STEP).toBe(0);
});

test('a manager reads plain words, never raw seconds they have to divide by 60', () => {
  expect(formatHideNames(10)).toBe('10 seconds');
  expect(formatHideNames(45)).toBe('45 seconds');
  expect(formatHideNames(60)).toBe('1 minute');       // singular, not "1 minutes"
  expect(formatHideNames(90)).toBe('1 minute 30s');
  expect(formatHideNames(120)).toBe('2 minutes');
  expect(formatHideNames(300)).toBe('5 minutes');
});

test('a tablet configured BEFORE this setting existed still hides its names', () => {
  // The real migration case: tablets in the restaurants already hold a settings object
  // with no hideNamesSeconds key. If the merge or the clamp is ever dropped, the value
  // arrives as undefined, the timer never arms, and the roster is on display all day —
  // silently, because nothing throws.
  stubStorage(JSON.stringify({
    companyId: 3, companyName: 'Ssam Korean BBQ', tabletName: 'Old Tablet',
    fullscreenLock: true, idleSeconds: 5, sound: false, showWorkingNow: true,
  }));
  const s = loadKioskSettings();
  expect(s.hideNamesSeconds).toBe(KIOSK_DEFAULTS.hideNamesSeconds);
  expect(Number.isFinite(s.hideNamesSeconds)).toBe(true);
  expect(s.companyId).toBe(3);          // the rest of the legacy object survives
  expect(s.idleSeconds).toBe(5);
});

test('a corrupt or hostile stored value cannot switch hiding off', () => {
  // localStorage is user-writable and survives upgrades — never trust what comes back.
  for (const bad of ['0', '-1', 'null', '"forever"', '{}', 'true', '1e999']) {
    stubStorage(`{"companyId":3,"hideNamesSeconds":${bad}}`);
    const s = loadKioskSettings();
    expect(s.hideNamesSeconds).toBeGreaterThanOrEqual(HIDE_NAMES_MIN);
    expect(s.hideNamesSeconds).toBeLessThanOrEqual(HIDE_NAMES_MAX);
  }
  stubStorage('not json at all');
  expect(loadKioskSettings().hideNamesSeconds).toBe(KIOSK_DEFAULTS.hideNamesSeconds);
});

test('a stored value that parses but is not an object does not stop the tablet booting', () => {
  // "null", "42" and "[]" all survive JSON.parse. Spreading them used to throw, which on a
  // kiosk means the screen never renders at all — worse than any wrong setting.
  for (const hostile of ['null', '42', '"a string"', '[]', 'false']) {
    stubStorage(hostile);
    expect(() => loadKioskSettings()).not.toThrow();
    expect(loadKioskSettings().hideNamesSeconds).toBe(KIOSK_DEFAULTS.hideNamesSeconds);
    expect(loadKioskSettings().idleSeconds).toBe(KIOSK_DEFAULTS.idleSeconds);
  }
  stubStorage(null); // nothing stored at all — a brand-new tablet
  expect(loadKioskSettings().hideNamesSeconds).toBe(KIOSK_DEFAULTS.hideNamesSeconds);
});

test('a nonsense stored value is clamped rather than shown or obeyed', () => {
  // localStorage is user-writable and survives app upgrades, so the value read back is not
  // trustworthy. Out-of-range must land inside the range, never at 0 (= names never hidden).
  expect(formatHideNames(0)).toBe('10 seconds');
  expect(formatHideNames(-99)).toBe('10 seconds');
  expect(formatHideNames(99_999)).toBe('5 minutes');
  expect(formatHideNames(NaN)).toBe('1 minute');       // falls back to the default
  expect(formatHideNames(Infinity)).toBe('1 minute');
  expect(formatHideNames(47.6)).toBe('48 seconds');    // rounded, not truncated to a float
});
