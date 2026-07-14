import { test, expect } from '@playwright/test';
import { ROUTES } from './routes';

for (const route of ROUTES) {
  test(`page loads cleanly: ${route}`, async ({ page }) => {
    // Needs a logged-in robot session; skip cleanly when creds aren't provided.
    test.skip(!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD, 'no smoke creds');

    // Collect uncaught JavaScript errors thrown while the page runs.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

    // 1. The server returned a real, non-error response.
    expect(response, `no response received for ${route}`).toBeTruthy();
    expect(
      response!.status(),
      `server returned ${response!.status()} for ${route}`,
    ).toBeLessThan(400);

    // 2. We were not bounced back to the login page (session works).
    expect(
      new URL(page.url()).pathname,
      `got redirected to login when visiting ${route}`,
    ).not.toMatch(/^\/login/);

    // 3. The page shows real content, not a blank/white screen.
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, `page appears blank at ${route}`).toBeGreaterThan(0);

    // 4. No Next.js crash overlay is present.
    await expect(
      page.locator('nextjs-portal'),
      `Next.js error overlay shown at ${route}`,
    ).toHaveCount(0);

    // 5. No uncaught JavaScript errors fired while loading.
    expect(
      pageErrors,
      `uncaught page errors at ${route}: ${pageErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
}
