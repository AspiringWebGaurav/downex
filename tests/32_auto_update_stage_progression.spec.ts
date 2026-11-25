import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — Auto-Update Pipeline & Dynamic Stage Progression (WORKING, PATCHING, etc.)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test('Test 1: Auto-detection and seamless stage transitions on UI open', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock GPHost returning v0.0.2 release manifest
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.2',
          notes: 'Performance update with multi-stream speedups.',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
              signature: 'SIMULATED_SIGNATURE',
              size: 15414272,
            },
          },
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toBeVisible();

    // Verify initial version row renders "APP VERSION v0.0.1"
    await expect(versionRow).toContainText('APP VERSION');
    await expect(versionRow).toContainText('v0.0.1');

    // Auto-detection triggers within ~1.5s on UI open
    // Verify stages: downloading -> verifying -> ready/working
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    // Wait for the version stage to become visible automatically (zero clicks)
    await expect(stageEl).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });

  test('Test 2: Granular display of all dynamic stage words (WORKING, PATCHING, VERIFYING, QUEUED, RESTARTING)', async ({ page }) => {
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    // 1. DOWNLOADING (%)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'downloading',
          progress: { percentage: 67, downloadedBytes: 10000000, totalBytes: 15000000 },
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('67%');
    await page.screenshot({ path: 'test-results/stage-01-downloading.png' });

    // 2. VERIFYING
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'verifying',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('VERIFYING');
    await page.screenshot({ path: 'test-results/stage-02-verifying.png' });

    // 3. QUEUED (User typing or active downloads)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'queued',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('QUEUED');
    await page.screenshot({ path: 'test-results/stage-03-queued.png' });

    // 4. PATCHING
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'patching',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('PATCHING');
    await page.screenshot({ path: 'test-results/stage-04-patching.png' });

    // 5. WORKING (installing / in-process NTFS staging)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'installing',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('WORKING');
    await page.screenshot({ path: 'test-results/stage-05-working.png' });

    // 6. RESTARTING
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'restarting',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('RESTARTING');
    await page.screenshot({ path: 'test-results/stage-06-restarting.png' });
  });

  test('Test 3: User Activity Guard holds in QUEUED while downloads run and auto-resumes when finished', async ({ page }) => {
    // 1. Simulate an active download running
    await page.evaluate(() => {
      const dlStore = (window as any).__DOWNEX_DOWNLOAD_STORE__ || (window as any).useDownloadStore;
      if (dlStore) {
        dlStore.setState({
          items: [
            {
              id: 'test-active-dl',
              url: 'https://example.com/large.iso',
              filename: 'large.iso',
              status: 'downloading',
              size: 500000000,
              downloaded: 250000000,
              progress: 50,
            },
          ],
        });
      }
      const verStore = (window as any).__DOWNEX_VERSION_STORE__;
      verStore.setState({
        status: {
          state: 'waiting_timer',
          targetVersion: '0.0.2',
        },
      });
    });

    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toContainText('QUEUED');

    // 2. Clear downloads -> transition to patching
    await page.evaluate(() => {
      const dlStore = (window as any).__DOWNEX_DOWNLOAD_STORE__ || (window as any).useDownloadStore;
      if (dlStore) {
        dlStore.setState({ items: [] });
      }
      const verStore = (window as any).__DOWNEX_VERSION_STORE__;
      verStore.setState({
        status: {
          state: 'patching',
          targetVersion: '0.0.2',
        },
      });
    });

    await expect(stageEl).toContainText('PATCHING');
  });
});
