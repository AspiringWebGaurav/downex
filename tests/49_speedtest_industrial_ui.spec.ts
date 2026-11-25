import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Speed Test Industrial UI/UX Verification', () => {
  test.use({
    viewport: { width: 960, height: 640 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Capture Industrial Speed Test UI in Light and Dark Modes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Speed Test
    const speedtestBtn = page.locator('aside button:has-text("Speed Test")');
    await expect(speedtestBtn).toBeVisible();
    await speedtestBtn.click();
    await page.waitForTimeout(300);

    // Verify industrial header
    await expect(page.locator('h1:has-text("Live Speed Test")')).toBeVisible();
    await expect(page.locator('text=REAL EDGE CDN')).toBeVisible();

    // Verify 4-tile industrial metrics
    await expect(page.getByText('Ping', { exact: true })).toBeVisible();
    await expect(page.getByText('Jitter', { exact: true })).toBeVisible();
    await expect(page.getByText('Download', { exact: true })).toBeVisible();
    await expect(page.getByText('Upload', { exact: true })).toBeVisible();

    // 1. Capture Light Mode Screenshot
    const lightPath = path.join(screenshotDir, 'speedtest_industrial_light.png');
    await page.screenshot({ path: lightPath });
    console.log(`Saved screenshot: ${lightPath}`);

    // 2. Switch to Dark Mode
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);

      const darkPath = path.join(screenshotDir, 'speedtest_industrial_dark.png');
      await page.screenshot({ path: darkPath });
      console.log(`Saved screenshot: ${darkPath}`);
    }
  });
});
