/**
 * E2E: reusable Guide Library (Task Manager) — real-browser, staging.
 *
 * Verifies the library re-architecture end-to-end through an authenticated
 * browser session: the library list + read, step-media serving, an aggregate
 * save round-trip + the optimistic-concurrency 409, the task→guide link, the
 * staff Training list/read/media, the FROZEN daily snapshot still playing, and
 * both new pages rendering. Targets the migrated "Grill Station Setup" guide
 * (now a library guide; task template 4 / line 41; daily snapshot line 252).
 *
 * Admin biz@krawings.de has companies [1,2,3,6] incl. the guide's company (2).
 * Env (defaults target staging): SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const TEMPLATE_ID = 4;
const LINE_ID = 41;
const DAILY_LINE_ID = 252;
const GUIDE_NAME = 'Grill Station Setup';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  const btn = page.getByRole('button', { name: /sign in|log in|anmelden/i });
  if (await btn.count()) await btn.first().click(); else await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('unauthenticated library API is not readable', async ({ request }) => {
  const r = await request.get('/api/tasks/guides', { failOnStatusCode: false, maxRedirects: 0 });
  expect(r.status()).not.toBe(200);
});

test('library: list, read, media, save round-trip + 409, link, training, frozen daily, pages', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  // 1) The library lists the migrated guide (published, 1 step, used by 1 task).
  const list = await page.request.get('/api/tasks/guides');
  expect(list.ok()).toBeTruthy();
  const { guides } = await list.json();
  const summary = guides.find((g: { name: string }) => g.name === GUIDE_NAME);
  expect(summary, 'library must contain the migrated guide').toBeTruthy();
  expect(summary.published).toBe(true);
  expect(summary.step_count).toBe(1);
  expect(summary.template_line_count).toBeGreaterThanOrEqual(1);
  const guideId: number = summary.id;

  // 2) Full read: 1 photo step with a photo + 2 pins.
  const read = await page.request.get(`/api/tasks/guides/${guideId}`);
  expect(read.ok()).toBeTruthy();
  const guide = await read.json();
  expect(guide.name).toBe(GUIDE_NAME);
  expect(guide.steps.length).toBe(1);
  const step = guide.steps[0];
  expect(step.media_type).toBe('photo');
  expect(step.has_image).toBe(true);
  expect(step.pins.length).toBe(2);

  // 3) The step's photo serves as an image (parent-scoped media route).
  const media = await page.request.get(`/api/tasks/guides/${guideId}/steps/${step.id}/media`);
  expect(media.ok()).toBeTruthy();
  expect(media.headers()['content-type'] || '').toContain('image/');

  // 4) Aggregate save round-trip — keep the photo + same content, revision bumps.
  const keptSteps = [{
    id: step.id,
    media_type: 'photo',
    explanation: step.explanation,
    pins: step.pins.map((p: { pin_x: number; pin_y: number; note: string }) => ({ pin_x: p.pin_x, pin_y: p.pin_y, note: p.note })),
  }];
  const put = await page.request.put(`/api/tasks/guides/${guideId}`, {
    data: { revision: guide.revision, published: true, name: guide.name, steps: keptSteps },
  });
  expect(put.ok()).toBeTruthy();
  expect((await put.json()).revision).toBe(guide.revision + 1);

  // 5) A stale revision now conflicts (409), not last-write-wins.
  const stale = await page.request.put(`/api/tasks/guides/${guideId}`, {
    data: { revision: guide.revision, published: true, name: guide.name, steps: keptSteps },
    failOnStatusCode: false,
  });
  expect(stale.status()).toBe(409);

  // 6) The task→guide link: line 41 links this guide.
  const link = await page.request.get(`/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide-link`);
  expect(link.ok()).toBeTruthy();
  const linkBody = await link.json();
  expect(linkBody.guide_id).toBe(guideId);
  expect(linkBody.published).toBe(true);

  // 7) Staff Training lists the published guide and reads it (+ media serves).
  //    NB: the save round-trip above rebuilt the aggregate, so the step has a
  //    NEW id now — re-read to get the current one (using the stale id 404s,
  //    which is the correct substitution guard).
  const training = await page.request.get('/api/tasks/training/guides');
  expect(training.ok()).toBeTruthy();
  const tGuide = (await training.json()).guides.find((g: { id: number }) => g.id === guideId);
  expect(tGuide, 'training must list the published guide').toBeTruthy();
  const tRead = await page.request.get(`/api/tasks/training/guides/${guideId}`);
  expect(tRead.ok()).toBeTruthy();
  const tSteps = (await tRead.json()).steps;
  expect(tSteps.length).toBe(1);
  const tMedia = await page.request.get(`/api/tasks/training/guides/${guideId}/steps/${tSteps[0].id}/media`);
  expect(tMedia.ok()).toBeTruthy();
  expect(tMedia.headers()['content-type'] || '').toContain('image/');

  // 8) The FROZEN daily snapshot still plays (independent of the guide edits above).
  const daily = await page.request.get(`/api/tasks/lines/${DAILY_LINE_ID}/guide`);
  expect(daily.ok()).toBeTruthy();
  const dailyGuide = await daily.json();
  expect(dailyGuide.steps.length).toBeGreaterThan(0);
  expect(dailyGuide.steps[0].media_type).toBe('photo');
  expect(dailyGuide.steps[0].pins.length).toBe(2);

  // 9) Both new pages render.
  await page.goto('/tasks/manager/training', { waitUntil: 'networkidle' });
  await expect(page.getByText(GUIDE_NAME).first()).toBeVisible({ timeout: 20_000 });
  await page.goto('/tasks/training', { waitUntil: 'networkidle' });
  await expect(page.getByText(GUIDE_NAME).first()).toBeVisible({ timeout: 20_000 });
});
