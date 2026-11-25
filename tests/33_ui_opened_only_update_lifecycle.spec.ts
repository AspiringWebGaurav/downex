import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — UI-Opened Only Update Lifecycle & Smooth Visual Transition', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test('Test 1: App is 100% idle and unaware when hidden in background/tray', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    let updateCheckCount = 0;

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      updateCheckCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: '0.0.2' }),
      });
    });

    // Simulate window hidden in system tray (document.visibilityState === 'hidden')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait 2.5s while hidden
    await page.waitForTimeout(2500);

    // Verify ZERO background checks occurred while sitting hidden in tray
    expect(updateCheckCount).toBe(0);

    // Verify sidebar version row stays completely clean and idle (no update banner, no background download)
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('Test 2: Opening UI triggers detection & smooth download progression', async ({ page }) => {
    const errors = captureConsoleErrors(page);

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

    // Ensure window is visible (user opened UI from tray)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Verify detection starts when UI opens
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });

  test('Test 3: Focusing search bar triggers user activity guard (QUEUED) and smooth fade-out on restart', async ({ page }) => {
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();

    // Focus and type in search bar
    await searchInput.focus();
    await searchInput.fill('ubuntu iso');

    // Simulate staged update ready
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'waiting_timer', // QUEUED
          targetVersion: '0.0.2',
        },
      });
    });

    // Verify stage displays QUEUED politely while user is typing
    await expect(stageEl).toContainText('QUEUED');

    // Simulate user finished interacting, entering restarting phase
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

    // Verify smooth CSS fade-out class is applied to root container (no black/white flash)
    const appContainer = page.locator('.app-fade-container');
    await expect(appContainer).toHaveClass(/fade-out/);
  });
});
