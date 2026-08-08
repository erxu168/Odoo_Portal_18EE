import { test, expect } from '@playwright/test';

/**
 * Warning stamps and text labels, saved through the real stack.
 *
 * READ-ONLY against Ethan's guides — a photo is borrowed from his grill guide
 * and everything is written to a throwaway this test creates and deletes.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || '',
  password: process.env.SMOKE_MANAGER_PASSWORD || '',
};
const SOURCE_GUIDE = 6;
const LABEL = 'Hot surface — do not touch';

test('a warning and a text label survive a save; a malformed one is dropped, never stored', async ({ page }) => {
  expect(MGR.email, 'SMOKE_MANAGER_EMAIL must be set').toBeTruthy();
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 25_000 });

  const g = await (await page.request.get(`/api/tasks/guides/${SOURCE_GUIDE}`)).json();
  const st = (g.steps || []).find((s: { media_type: string; has_image: boolean }) =>
    s.media_type === 'photo' && s.has_image);
  expect(st, 'a real photo to borrow').toBeTruthy();
  const b64 = Buffer.from(await (await page.request.get(
    `/api/tasks/guides/${SOURCE_GUIDE}/steps/${st.id}/media`)).body()).toString('base64');

  const made = await (await page.request.post('/api/tasks/guides',
    { data: { name: 'ZZ THROWAWAY stamps' } })).json();
  const id = made.id;
  expect(id).toBeTruthy();

  const step = (drawings: string) => ({
    media_type: 'photo', explanation: 'Careful here.',
    image_base64: b64, image_filename: 's.jpg', drawings,
  });

  try {
    const put = await page.request.put(`/api/tasks/guides/${id}`, {
      data: {
        revision: made.revision ?? 0, published: false, name: 'ZZ THROWAWAY stamps',
        steps: [step(JSON.stringify([
          { type: 'warning', color: '#DC2626', width: 4, points: [[0.5, 0.3]] },
          { type: 'text', color: '#FFFFFF', width: 3, points: [[0.2, 0.8]], text: LABEL },
          { type: 'arrow', color: '#2563EB', width: 2, points: [[0.1, 0.1], [0.4, 0.4]] },
        ]))],
      },
      timeout: 120_000,
    });
    expect(put.status(), await put.text()).toBe(200);

    const back = await (await page.request.get(`/api/tasks/guides/${id}`)).json();
    const saved = JSON.parse(back.steps[0].drawings);
    expect(saved, 'all three marks stored').toHaveLength(3);
    expect(saved.find((d: { type: string }) => d.type === 'warning').points,
      'a stamp is ONE anchor').toHaveLength(1);
    // Non-ASCII must survive the round trip — the label is the one thing here a
    // person reads word for word.
    expect(saved.find((d: { type: string }) => d.type === 'text').text).toBe(LABEL);

    // A malformed mark is DROPPED by the portal's normalise-on-save before Odoo
    // ever sees it, so the save succeeds and nothing bad is stored. Asserting
    // the storage, not the status code: "fails closed" is the property that
    // matters, and which layer says no is an implementation detail.
    const bad = await page.request.put(`/api/tasks/guides/${id}`, {
      data: {
        revision: back.revision, published: false, name: 'ZZ THROWAWAY stamps',
        steps: [step(JSON.stringify([
          { type: 'warning', color: '#DC2626', width: 2, points: [[0.1, 0.1], [0.2, 0.2]] },
          { type: 'text', color: '#DC2626', width: 2, points: [[0.5, 0.5]], text: '   ' },
        ]))],
      },
    });
    expect(bad.ok()).toBe(true);
    const after = await (await page.request.get(`/api/tasks/guides/${id}`)).json();
    expect(after.steps[0].drawings || '', 'a two-point stamp and an empty label are both dropped')
      .toBe('');
  } finally {
    expect((await page.request.delete(`/api/tasks/guides/${id}`)).ok(),
      'throwaway cleaned up').toBe(true);
  }
});
