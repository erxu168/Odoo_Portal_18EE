import { test, expect, Page } from '@playwright/test';

/**
 * The Task Manager's manager screens, in a real browser on staging.
 *
 * This exists because twelve commits shipped on 2026-08-07 with no browser
 * check at all — the robot logins were gone — and one of them was a regression
 * that wrote real completion data (closing a subtask photo ticked the subtask
 * off). An adversarial read caught that one; a browser would have caught it
 * sooner and cheaper.
 *
 * STRICTLY READ-ONLY. It navigates, reads, opens a menu and opens a photo.
 * It never saves, creates, deletes, ticks or drags anything — these are Ethan's
 * real records, and a test that "verifies" by re-saving one has already
 * destroyed real guide photos in this project once.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || '',
  password: process.env.SMOKE_MANAGER_PASSWORD || process.env.SMOKE_MANAGER_PW || '',
};

/** WAJ Kitchen, "Today's Tasks" — the template Ethan actually works in. */
const TEMPLATE_ID = 5;
/** The subtask he attached a photo to while testing the feature. */
const PHOTO_SUBTASK = 'Burger buns';

async function login(page: Page) {
  // Fail loudly rather than skip. A browser suite that silently runs zero
  // browsers is how this project got a green CI while testing nothing.
  expect(MGR.email, 'SMOKE_MANAGER_EMAIL must be set (.env.smoke.local)').toBeTruthy();
  expect(MGR.password, 'SMOKE_MANAGER_PASSWORD must be set').toBeTruthy();
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test.describe('Task Manager — manager screens after the 2026-08-07 changes', () => {
  test('the task list is cards with a chip row, a ⋮ menu and the subtask photo', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await login(page);
    await page.goto(`/tasks/manager/templates/${TEMPLATE_ID}`);

    // The screen loaded with real content, not an empty or error state.
    const addTask = page.getByRole('button', { name: 'Add task', exact: true });
    await expect(addTask, 'the create button').toBeVisible({ timeout: 25_000 });

    // 349f4af: the locked create standard is a full-width green button, not the
    // green text link it used to be. 200px is far below a phone's width and far
    // above any text link.
    const box = await addTask.boundingBox();
    expect(box, 'Add task must be laid out').toBeTruthy();
    expect(box!.width, 'Add task should be full-width, not a text link').toBeGreaterThan(200);
    expect(box!.height, 'Add task should meet the touch minimum').toBeGreaterThanOrEqual(44);

    // 37c2bfa: every task carries a ⋮ menu instead of Edit/Delete text links.
    const menus = page.getByRole('button', { name: /^Actions for / });
    await expect(menus.first(), 'a per-task ⋮ menu').toBeVisible();
    expect(await menus.count(), 'one menu per task').toBeGreaterThan(1);

    // The old treatment is gone: no bare Edit/Delete words on the rows.
    await expect(page.getByRole('button', { name: 'Delete', exact: true }))
      .toHaveCount(0);

    // 37c2bfa: the meta line became chips. "Daily" is the recurrence chip on
    // every one of Ethan's tasks.
    await expect(page.getByText('🔁 Daily').first(), 'a recurrence chip').toBeVisible();

    // The menu opens and holds both actions. Opening is read-only; Escape closes
    // it. Nothing inside is clicked.
    await menus.first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // c3bace6: the subtask photo shows on this screen at all, and its thumbnail
    // resolves — a broken image is what Ethan reported.
    const thumb = page.getByRole('button', { name: `Show the photo for ${PHOTO_SUBTASK}` });
    await expect(thumb, 'the subtask photo thumbnail').toBeVisible();
    const img = thumb.locator('img');
    await expect(img).toBeVisible();
    // naturalWidth is 0 when the browser could not decode the response — which
    // is exactly what a 404 JSON body into an <img> looks like.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);

    expect(consoleErrors, 'console errors on the task list screen').toEqual([]);
  });

  test('opening a subtask photo does not tick anything, and closes cleanly', async ({ page }) => {
    await login(page);
    await page.goto(`/tasks/manager/templates/${TEMPLATE_ID}`);

    const thumb = page.getByRole('button', { name: `Show the photo for ${PHOTO_SUBTASK}` });
    await expect(thumb).toBeVisible({ timeout: 25_000 });

    // 1176037: the enlarged photo must be a portal, not a child of the row —
    // in place, its backdrop bubbled a click into "this is done".
    await thumb.click();
    const dialog = page.getByRole('dialog', { name: `Photo for ${PHOTO_SUBTASK}` });
    await expect(dialog).toBeVisible();

    // The overlay is a direct child of <body>, so a click on it can never reach
    // the row it visually sits over.
    const parentIsBody = await dialog.evaluate((el) => el.parentElement === document.body);
    expect(parentIsBody, 'the photo dialog must be portalled to <body>').toBe(true);

    // Close by tapping the backdrop — the exact gesture that used to complete work.
    await dialog.click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();

    // Escape closes it too, via the shared modal stack.
    await thumb.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the staff preview offers no button that cannot work', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await login(page);
    await page.goto(`/tasks/manager/templates/${TEMPLATE_ID}`);
    await expect(page.getByRole('button', { name: 'Add task', exact: true }))
      .toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: /preview/i }).first().click();

    // e98329e: the preview's ids are fabricated and negative, so "Show me how"
    // could only ever open an error screen. It is an honest chip there now.
    await expect(page.getByRole('button', { name: /Show me how/ })).toHaveCount(0);
    await expect(page.getByText('Staff get a how-to here').first()).toBeVisible();

    expect(consoleErrors, 'console errors in preview').toEqual([]);
  });
});
