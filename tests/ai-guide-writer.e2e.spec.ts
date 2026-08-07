import { test, expect, Page } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The AI guide writer, end to end in a real browser on staging.
 *
 * This SPENDS MONEY (one real generation, a few cents) and CREATES a guide, so
 * it works on a throwaway of its own making and deletes it afterwards —
 * Ethan's real guides are only ever read, never written by a test.
 *
 * What it is really guarding: that the draft is a draft. The screen must say
 * so, and keeping it must produce an UNPUBLISHED guide. AI text about handling
 * fire and food must never reach a cook without a person choosing to publish.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || '',
  password: process.env.SMOKE_MANAGER_PASSWORD || '',
};

/** Ethan's real grill guide — a source of genuine kitchen photos to feed in. */
const SOURCE_GUIDE = 6;
const TITLE = 'ZZ THROWAWAY grill (e2e)';
const NOTES = [
  '- gas on first, then igniter, never the other way',
  '- takes 20 min to come up to temp, do not rush it',
  '- if it will not light twice, stop and get the shift lead',
].join('\n');

async function login(page: Page) {
  expect(MGR.email, 'SMOKE_MANAGER_EMAIL must be set (.env.smoke.local)').toBeTruthy();
  expect(MGR.password, 'SMOKE_MANAGER_PASSWORD must be set').toBeTruthy();
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

/** Pull two real photos off an existing guide and put them on disk, so the file
 *  picker has something genuine to swallow. */
async function realPhotos(page: Page, count: number): Promise<string[]> {
  const g = await (await page.request.get(`/api/tasks/guides/${SOURCE_GUIDE}`)).json();
  const steps = (g.steps || [])
    .filter((s: { media_type: string; has_image: boolean }) => s.media_type === 'photo' && s.has_image)
    .slice(0, count);
  expect(steps.length, 'real photos to feed the writer').toBe(count);

  const dir = mkdtempSync(join(tmpdir(), 'aiguide-'));
  const paths: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const r = await page.request.get(`/api/tasks/guides/${SOURCE_GUIDE}/steps/${steps[i].id}/media`);
    expect(r.ok()).toBe(true);
    const p = join(dir, `step${i + 1}.jpg`);
    writeFileSync(p, await r.body());
    paths.push(p);
  }
  return paths;
}

test('writes a draft guide from real photos, and it is genuinely a draft', async ({ page }) => {
  test.setTimeout(300_000);   // one real generation, plus staging round trips
  await login(page);
  const photos = await realPhotos(page, 2);

  await page.goto('/tasks/manager/training');
  await page.getByRole('button', { name: /Write one from photos/ }).click();

  await page.getByLabel('What is this guide for?').fill(TITLE);
  await page.getByLabel('What matters').fill(NOTES);

  // Add both photos through the real picker, one at a time, the way a manager
  // would. The gallery input is the one with an image filter and no camera.
  for (const p of photos) {
    await page.getByRole('button', { name: '+', exact: true }).click();
    await page.locator('input[type="file"][accept="image/*"]:not([capture])').first().setInputFiles(p);
    await page.waitForTimeout(400);   // client-side compression
  }
  await expect(page.getByAltText('Photo 1')).toBeVisible();
  await expect(page.getByAltText('Photo 2')).toBeVisible();

  await page.getByRole('button', { name: /Write the guide/ }).click();

  // The review phase. Generous timeout: this is a real vision call.
  await expect(page.getByText('Read this before you keep it', { exact: false }))
    .toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('it can be wrong about things that matter', { exact: false })).toBeVisible();
  await expect(page.getByText(/^Step 1/)).toBeVisible();

  await page.getByRole('button', { name: 'Keep it as a draft guide' }).click();

  // Keeping closes the writer and opens the ordinary editor. Assert the
  // WRITER went away: the library button behind it is still visible through the
  // modal, so its visibility says nothing.
  await expect(page.getByText('Read this before you keep it', { exact: false }))
    .toBeHidden({ timeout: 60_000 });

  // Find what it made, prove it is a DRAFT with real steps, then remove it.
  const list = await (await page.request.get('/api/tasks/guides')).json();
  const made = (list.guides || []).find((x: { name: string }) => x.name === TITLE);
  expect(made, 'the writer created a guide').toBeTruthy();
  try {
    expect(made.published, 'a generated guide must NEVER arrive published').toBeFalsy();
    const full = await (await page.request.get(`/api/tasks/guides/${made.id}`)).json();
    expect(full.steps.length, 'a step per photo').toBe(2);
    expect(full.steps[0].explanation.length, 'the first step was actually written').toBeGreaterThan(20);
    expect(full.steps[0].has_image, 'the photo travelled with the step').toBe(true);
  } finally {
    const del = await page.request.delete(`/api/tasks/guides/${made.id}`);
    expect(del.ok(), 'throwaway guide cleaned up').toBe(true);
  }
});
