import { chromium, devices, expect, test, type Page } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];

async function installabilityErrors(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const r = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
  return r.installabilityErrors.map((e) => e.errorId);
}

/**
 * Chrome's own installability checker only runs in the full Chromium build
 * (new headless mode) — the default headless shell always reports no errors,
 * which would make this test vacuous. A persistent (non-incognito) profile is
 * used because Chrome never offers installation in incognito.
 */
test('the PWA meets Chrome installability criteria and opens with no network', async ({ baseURL }, testInfo) => {
  const ctx = await chromium.launchPersistentContext(testInfo.outputPath('pwa-profile'), { ...pixel, channel: 'chromium', baseURL });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();

  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ short_name: 'PRECEPTOR', display: 'standalone', start_url: '/', scope: '/' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Negative control on another origin (no manifest, no service worker): the checker must report it.
  const plain = await ctx.newPage();
  await plain.route('http://127.0.0.1:4173/not-an-app.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title><p>x</p>' }),
  );
  await plain.goto('http://127.0.0.1:4173/not-an-app.html');
  const control = await installabilityErrors(plain);
  expect(control).toContain('no-manifest');
  expect(control).not.toContain('in-incognito');
  await plain.close();

  // The app itself: no installability errors.
  await expect.poll(() => installabilityErrors(page)).toEqual([]);

  // Cold start with no network: the precached shell is served by the service worker.
  await ctx.setOffline(true);
  const offlineNav = await page.reload();
  expect(offlineNav?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  await ctx.close();
});
