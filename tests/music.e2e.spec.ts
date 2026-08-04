import { test, expect, Page } from '@playwright/test';

/**
 * e2e (staging, self-login): WAJ Radio manager surface + server-side gating.
 *  - manager sees home / requests / settings / history screens
 *  - manual decisions round-trip (allow with genre → listed → reversed)
 *  - the player APIs refuse anything that is not the pinned tablet
 *  - a staff login cannot reach the manager APIs (module gate)
 * The player's YouTube playback itself is verified on the real Sunmi (runbook);
 * headless can't autoplay and has no station-device session.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAFF = {
  email: process.env.SMOKE_STAFF_EMAIL || 'hana@test.krawings.de',
  password: process.env.SMOKE_STAFF_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
// A synthetic 11-char video id: exercises the decision machinery without YouTube.
const FAKE_VID = `zzE2E${STAMP.slice(-6)}`;

async function login(page: Page, email: string, password: string): Promise<boolean> {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
    return true;
  } catch {
    return false;
  }
}

test('manager: home, requests, settings and history screens render', async ({ page }) => {
  expect(await login(page, MGR.email, MGR.password)).toBeTruthy();

  await page.goto('/music');
  await expect(page.getByText('WAJ Radio', { exact: true })).toBeVisible();
  await expect(page.getByText('Requests waiting')).toBeVisible();

  await page.goto('/music/requests');
  await expect(page.getByText('Song Requests')).toBeVisible();
  await expect(page.getByText(/Waiting for you/)).toBeVisible();

  await page.goto('/music/settings');
  await expect(page.getByText('Which tablet plays the music?')).toBeVisible();
  await expect(page.getByText('Radio shelves')).toBeVisible();

  await page.goto('/music/history');
  await expect(page.getByText('Play History')).toBeVisible();
});

test('manager: manual decision round-trips (allow with genre, then reversed to deny)', async ({ page }) => {
  expect(await login(page, MGR.email, MGR.password)).toBeTruthy();

  const allow = await page.request.patch(`/api/music/decisions/${FAKE_VID}`, {
    data: { decision: 'allow', genre: 'reggae_dancehall_dub' },
  });
  expect(allow.ok(), `allow failed: ${await allow.text()}`).toBeTruthy();

  const list1 = await (await page.request.get('/api/music/decisions')).json();
  const row1 = (list1.decisions ?? []).find((d: { video_id: string }) => d.video_id === FAKE_VID);
  expect(row1?.decision).toBe('allow');
  expect(row1?.genre).toBe('reggae_dancehall_dub');

  // Allow without a genre must be rejected (the radio needs a shelf).
  const bad = await page.request.patch(`/api/music/decisions/${FAKE_VID}`, { data: { decision: 'allow' } });
  expect(bad.status()).toBe(400);

  const deny = await page.request.patch(`/api/music/decisions/${FAKE_VID}`, { data: { decision: 'deny' } });
  expect(deny.ok()).toBeTruthy();
  const list2 = await (await page.request.get('/api/music/decisions')).json();
  const row2 = (list2.decisions ?? []).find((d: { video_id: string }) => d.video_id === FAKE_VID);
  expect(row2?.decision).toBe('deny');
});

test('player APIs refuse a manager phone — only the pinned tablet may drive playback', async ({ page }) => {
  expect(await login(page, MGR.email, MGR.password)).toBeTruthy();

  const state = await page.request.get('/api/music/player/state');
  expect([403, 409]).toContain(state.status());

  const queue = await page.request.post('/api/music/queue', {
    data: { videoId: FAKE_VID, idempotencyKey: `e2e_${STAMP}` },
  });
  expect([403, 409]).toContain(queue.status());

  const skip = await page.request.post('/api/music/player/skip', { data: { version: 1 } });
  expect([403, 409]).toContain(skip.status());
});

test('staff cannot reach the manager APIs (module gate is server-side)', async ({ page }) => {
  const ok = await login(page, STAFF.email, STAFF.password);
  test.skip(!ok, 'no staff test login on this staging');

  const requests = await page.request.get('/api/music/requests');
  expect(requests.status()).toBe(403);
  const decide = await page.request.patch(`/api/music/decisions/${FAKE_VID}`, { data: { decision: 'deny' } });
  expect(decide.status()).toBe(403);
});
