import { test, expect } from '@playwright/test';
import { isPublicPath } from '../src/middleware';

/**
 * The public-path whitelist must match on PATH BOUNDARIES.
 * Regression guard for a real bug: adding '/cooktimer' (the no-login kitchen
 * tablet screen) to the whitelist ALSO made '/cooktimer-setup' — the MANAGER
 * setup screen — public, because matching was a bare startsWith.
 */

test('the no-login kitchen tablet screen and its operating APIs are public', () => {
  expect(isPublicPath('/cooktimer')).toBe(true);
  expect(isPublicPath('/api/cooktimer/queue')).toBe(true);
  expect(isPublicPath('/api/cooktimer/start')).toBe(true);
  expect(isPublicPath('/api/cooktimer/timers')).toBe(true);
  expect(isPublicPath('/api/cooktimer/timers/12/advance')).toBe(true);
});

test('the MANAGER setup screen and its APIs are NOT public', () => {
  expect(isPublicPath('/cooktimer-setup')).toBe(false);      // the bug this guards
  expect(isPublicPath('/api/cooktimer/profiles')).toBe(false);
  expect(isPublicPath('/api/cooktimer/profiles/3')).toBe(false);
  expect(isPublicPath('/api/cooktimer/stations')).toBe(false);
  expect(isPublicPath('/api/cooktimer/stations/2')).toBe(false);
});

test('a sibling path that merely shares a prefix is never public', () => {
  expect(isPublicPath('/kds-admin')).toBe(false);
  expect(isPublicPath('/kiosk-settings')).toBe(false);
  expect(isPublicPath('/logins')).toBe(false);
  expect(isPublicPath('/registerx')).toBe(false);
});

test('existing public routes still work (no collateral gating)', () => {
  for (const p of [
    '/login', '/register', '/forgot-password', '/reset-password',
    '/api/auth/me', '/api/cron/prep-forecast', '/api/internal/x', '/api/products/search',
    '/kds', '/kds/anything', '/api/kds/orders', '/kiosk', '/api/kiosk/admin-login',
    '/api/tablet/x', '/api/device/ping', '/invite/tok', '/api/invite/tok',
    '/confirm-shift', '/api/shifts/confirm/email',
  ]) {
    expect(isPublicPath(p), `${p} must stay public`).toBe(true);
  }
});

test('ordinary app routes stay gated', () => {
  for (const p of ['/', '/inventory', '/products/456', '/admin/staff', '/shifts', '/hr']) {
    expect(isPublicPath(p), `${p} must stay gated`).toBe(false);
  }
});
