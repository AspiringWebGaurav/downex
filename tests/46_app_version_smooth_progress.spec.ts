import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('App Version Smooth Animation & GPU Progress Bar', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Capture App Version progress bar at multiple stages in Light and Dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="sidebar-version"]', { timeout: 15000 });

    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toBeVisible();

    // 1. Idle expanded screenshot
    await versionRow.screenshot({ path: path.join(screenshotDir, 'app_version_01_idle_light.png') });

    // 2. Simulate 45% OTA downloading
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'downloading',
            progress: { percentage: 45 },
            targetVersion: '0.0.2',
          },
        });
      }
    });
    await page.waitForTimeout(300);
    await versionRow.screenshot({ path: path.join(screenshotDir, 'app_version_02_45pct_light.png') });

    // 3. Simulate 85% OTA downloading
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'downloading',
            progress: { percentage: 85 },
            targetVersion: '0.0.2',
          },
        });
      }
    });
    await page.waitForTimeout(300);
    await versionRow.screenshot({ path: path.join(screenshotDir, 'app_version_03_85pct_light.png') });

    // 4. Switch to Dark mode and capture 85% OTA downloading
    await page.locator('button:has-text("Dark mode")').click();
    await page.waitForTimeout(300);
    await versionRow.screenshot({ path: path.join(screenshotDir, 'app_version_04_85pct_dark.png') });

    // 5. Full sidebar in Dark mode with 85% progress
    const sidebar = page.locator('aside');
    await sidebar.screenshot({ path: path.join(screenshotDir, 'app_version_05_sidebar_dark.png') });
  });
});
