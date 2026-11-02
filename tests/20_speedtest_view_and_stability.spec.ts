import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Live Speed Test UI & Stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.waitForLoadState('domcontentloaded');
  });

  test('Speed Test option is in sidebar directly above Trash', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    const speedtestBtn = page.locator('button', { hasText: 'Speed Test' });
    const trashBtn = page.locator('button', { hasText: 'Trash' });

    await expect(speedtestBtn).toBeVisible();
    await expect(trashBtn).toBeVisible();

    const speedtestBox = await speedtestBtn.boundingBox();
    const trashBox = await trashBtn.boundingBox();

    expect(speedtestBox).not.toBeNull();
    expect(trashBox).not.toBeNull();

    // Verify Speed Test is placed directly above Trash (speedtest.y < trash.y)
    if (speedtestBox && trashBox) {
      expect(speedtestBox.y).toBeLessThan(trashBox.y);
      // Directly adjacent (within 55px vertical distance)
      expect(trashBox.y - speedtestBox.y).toBeLessThan(55);
    }
  });

  test('Speed Test view has STRICTLY ZERO vertical scrollbar at 960x640', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(100);

    const speedtestBtn = page.locator('button', { hasText: 'Speed Test' });
    await speedtestBtn.click();
    await page.waitForTimeout(250);

    // Verify Speed Test header and gauge exist
    await expect(page.locator('h1', { hasText: 'Live Speed Test' })).toBeVisible();
    await expect(page.locator('[data-testid="speedometer-svg"]')).toBeVisible();

    // Verify 4-metric grid elements
    await expect(page.getByText('Ping', { exact: true })).toBeVisible();
    await expect(page.getByText('Jitter', { exact: true })).toBeVisible();
    await expect(page.getByText('Download', { exact: true })).toBeVisible();
    await expect(page.getByText('Upload', { exact: true })).toBeVisible();

    // Verify main content container has NO vertical scrollbar (scrollHeight <= clientHeight)
    const mainContainer = page.locator('main');
    await expect(mainContainer).toBeVisible();

    const isScrollable = await mainContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(isScrollable).toBe(false);

    // Take screenshot for visual audit
    await page.screenshot({ path: 'test-results/speedtest-view-960x640.png' });
  });

  test('Speed Test maintains single-view and ZERO vertical scroll at minimum size 820x540', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 540 });
    await page.waitForTimeout(150);

    const speedtestBtn = page.locator('button', { hasText: 'Speed Test' });
    await speedtestBtn.click();
    await page.waitForTimeout(250);

    await expect(page.locator('h1', { hasText: 'Live Speed Test' })).toBeVisible();

    const mainContainer = page.locator('main');
    await expect(mainContainer).toBeVisible();

    const isScrollable = await mainContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(isScrollable).toBe(false);

    // Take screenshot for minimum size visual audit
    await page.screenshot({ path: 'test-results/speedtest-view-820x540-min.png' });
  });

  test('Speed Test opens completely fresh (NON-PERSISTENT) with clean dial and zero needle slicing', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(100);

    const speedtestBtn = page.locator('button', { hasText: 'Speed Test' });
    await speedtestBtn.click();
    await page.waitForTimeout(200);

    // Verify fresh state: START button is present, metrics are unset '--'
    const startBtn = page.getByRole('button', { name: 'START', exact: true });
    await expect(startBtn).toBeVisible();

    // Verify metrics are initially '--' (clean, non-persistent)
    const dashes = await page.getByText('--').count();
    expect(dashes).toBeGreaterThanOrEqual(2);

    // Verify NO needle line is piercing through the center inside the dial
    const dialLines = await page.locator('[data-testid="speedometer-svg"] line').count();
    expect(dialLines).toBe(0); // Zero needle lines slicing through the center

    // Verify scale markers are visible
    await expect(page.getByText('100 Mbps')).toBeVisible();

    // Take screenshot of fresh non-persistent display
    await page.screenshot({ path: 'test-results/speedtest-fresh-state.png' });
  });

  test('Start, Stop, and Reset lifecycle works cleanly and resets fresh', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.waitForTimeout(100);

    const speedtestBtn = page.locator('button', { hasText: 'Speed Test' });
    await speedtestBtn.click();
    await page.waitForTimeout(200);

    // 1. Click START button in the center
    const startBtn = page.getByRole('button', { name: 'START', exact: true });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 2. Verify it switches to Stop button during test
    const stopBtn = page.locator('button', { hasText: 'Stop' });
    await expect(stopBtn).toBeVisible({ timeout: 5000 });

    // 3. Click Stop to abort test cleanly
    await stopBtn.click();
    await page.waitForTimeout(250);

    // 4. Verify START button or Start Speed Test is restored
    const readyAction = page.locator('button', { hasText: /Start Speed Test|START/i }).first();
    await expect(readyAction).toBeVisible();
  });
});
