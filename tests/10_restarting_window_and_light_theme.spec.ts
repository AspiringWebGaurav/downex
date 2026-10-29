import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — Dedicated Light-Theme Restarting Window & Handoff UI', () => {
  test.beforeEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Dedicated RestartingWindow loads in pure light theme and executes 7-second service sequence', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Navigate to dedicated window route with target version query
    await page.goto('/?window=restarting&target=0.0.7');
    await page.waitForLoadState('domcontentloaded');

    // 1. Verify Light Theme Styling (Pure White background, dark typography, light border)
    const windowRoot = page.locator('div[data-tauri-drag-region]').first();
    await expect(windowRoot).toBeVisible();

    const bgColor = await windowRoot.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    // In light theme, background must be white (rgb(255, 255, 255)), never dark (rgb(9, 9, 11) or black)
    expect(bgColor).toBe('rgb(255, 255, 255)');

    // 2. Verify Title and Target Version
    await expect(page.locator('text=Please wait, apps and services restarting...')).toBeVisible();
    await expect(page.locator('text=v0.0.7')).toBeVisible();

    // 3. Verify All 4 Service Milestone Steps Exist
    await expect(page.locator('text=Pausing active downloads & queue state')).toBeVisible();
    await expect(page.locator('text=Flushing SQLite database & WAL transactions')).toBeVisible();
    await expect(page.locator('text=Releasing single-instance socket & IPC handles')).toBeVisible();
    await expect(page.locator('text=Launching updated Downex engine...')).toBeVisible();

    // 4. Verify Progress Bar and Telemetry Label
    await expect(page.locator('text=Restarting services')).toBeVisible();

    // 5. Verify Milestones Step Progression across the 7-second lifecycle
    // Initially (<1.0s), Step 1 is in progress
    await page.waitForTimeout(2000);
    // After 2.0s: Step 1 is complete (CheckCircle2 rendered for Step 1)
    const checkmarksAfter2s = await page.locator('svg.text-emerald-600').count();
    expect(checkmarksAfter2s).toBeGreaterThanOrEqual(1);

    // Wait until 4.0s: Step 2 is complete
    await page.waitForTimeout(2000);
    const checkmarksAfter4s = await page.locator('svg.text-emerald-600').count();
    expect(checkmarksAfter4s).toBeGreaterThanOrEqual(2);

    expect(errors).toEqual([]);
  });

  test('RestartingModal renders in light theme inside main app with 7-second telemetry', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Trigger state: 'restarting'
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'restarting',
            targetVersion: '0.0.7',
          },
        });
      }
    });

    // 1. Verify modal card is visible
    const modalHeading = page.locator('text=Please wait, apps and services restarting...');
    await expect(modalHeading).toBeVisible();

    // 2. Verify light theme card
    const cardEl = page.locator('div.bg-white').first();
    const cardBg = await cardEl.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    // Modal card must be white in light theme
    expect(cardBg).toBe('rgb(255, 255, 255)');

    // 3. Verify target version
    await expect(page.locator('text=v0.0.7')).toBeVisible();

    // 4. Verify telemetry milestones
    await expect(page.locator('text=Pausing active downloads & queue state')).toBeVisible();
    await expect(page.locator('text=Flushing SQLite database & WAL transactions')).toBeVisible();
    await expect(page.locator('text=Releasing single-instance socket & IPC handles')).toBeVisible();
    await expect(page.locator('text=Launching updated Downex engine...')).toBeVisible();
    await expect(page.locator('text=Restarting services')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
