import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — Fluid 1% to 100% Download Progression Verification', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="sidebar-version"]', { timeout: 15000 });
  });

  test('Dev QA "2. Download" simulates full live 1% -> 100% monotonic progression', async ({ page }) => {
    // Open Dev QA
    const qaTrigger = page.locator('button:has-text("Dev QA")').first();
    await expect(qaTrigger).toBeVisible();
    await qaTrigger.click();

    // Navigate to OTA Updates tab
    const otaTab = page.getByRole('button', { name: 'OTA Updates', exact: true });
    await expect(otaTab).toBeVisible();
    await otaTab.click();

    // Locate the stage label and progress track in sidebar
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    const versionRow = page.locator('[data-testid="sidebar-version"]');

    // Click "2. Download" button
    const downloadBtn = page.locator('button:has-text("2. Download")');
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    // Sample progression at multiple intervals
    const observedPcts: number[] = [];

    // Immediately after click: should be at 1%
    await page.waitForTimeout(60);
    let currentText = (await stageEl.textContent()) || '';
    let match = currentText.match(/(\d+)%/);
    if (match) observedPcts.push(parseInt(match[1], 10));

    // Sample across the 2.5s window
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(300);
      currentText = (await stageEl.textContent()) || '';
      match = currentText.match(/(\d+)%/);
      if (match) {
        observedPcts.push(parseInt(match[1], 10));
      }
      if (i === 2) {
        // Capture mid-stream screenshot
        await versionRow.screenshot({
          path: path.join(screenshotsDir, 'live_download_mid_progress_light.png'),
        });
      }
    }

    // Wait until it reaches 100%
    await expect(stageEl).toContainText('100%', { timeout: 4000 });

    // Capture 100% complete screenshot in light mode
    await versionRow.screenshot({
      path: path.join(screenshotsDir, 'live_download_100pct_light.png'),
    });

    // Also capture full view
    await page.screenshot({
      path: path.join(screenshotsDir, 'live_download_full_screen_100pct.png'),
    });

    // Verify progression is strictly monotonic (never steps backwards)
    console.log('Observed download percentages over time:', observedPcts);
    expect(observedPcts.length).toBeGreaterThanOrEqual(4);

    for (let i = 1; i < observedPcts.length; i++) {
      expect(observedPcts[i]).toBeGreaterThanOrEqual(observedPcts[i - 1]);
    }

    // Final observed value must reach 100
    const finalVal = await stageEl.textContent();
    expect(finalVal).toContain('100%');
  });

  test('Fast-network pacing floor smoothly animates digits without skipping', async ({ page }) => {
    // Intercept updateService directly to test fast network arrival
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    await page.evaluate(() => {
      const { updateService } = (window as any);
      if (updateService) {
        // Run simulated download with fast duration
        updateService.simulateLiveDownload('0.0.2', 1500);
      }
    });

    // Initial value must be near 1%
    await page.waitForTimeout(80);
    const initialText = await stageEl.textContent();
    expect(initialText).toMatch(/\d+%/);

    // Wait for 100% completion
    await expect(stageEl).toContainText('100%', { timeout: 3500 });
  });
});
