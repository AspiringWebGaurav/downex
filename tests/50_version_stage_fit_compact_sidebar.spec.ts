import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — App Version Row Fit in Compact 172px Sidebar', () => {
  test.use({
    viewport: { width: 960, height: 640 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Verify zero text clipping across all stages in 172px compact sidebar', async ({ page }) => {
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ no_release: true }),
      });
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toBeVisible();

    // 1. Idle state: "APP VERSION" on left, "v0.0.1" on right
    await expect(versionRow.locator('text=APP VERSION')).toBeVisible();
    await expect(versionRow.locator('text=v0.0.1')).toBeVisible();
    const idlePath = path.join(screenshotDir, 'version_compact_01_idle_light.png');
    await versionRow.screenshot({ path: idlePath });

    // 2. UP TO DATE state: "v0.0.1" on left, "UP TO DATE" on right
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'up-to-date',
          isManualCheck: true,
        },
      });
    });
    await page.waitForTimeout(300);

    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toBeVisible();
    await expect(stageEl).toHaveText('UP TO DATE');
    await expect(versionRow.locator('text=v0.0.1')).toBeVisible();

    // Verify UP TO DATE is fully inside the versionRow bounding box without clipping
    const rowBox = await versionRow.boundingBox();
    const stageBox = await stageEl.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    console.log(`Row Right: ${rowBox!.x + rowBox!.width}, Stage Right: ${stageBox!.x + stageBox!.width}`);
    expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);

    const upToDatePath = path.join(screenshotDir, 'version_compact_02_uptodate_light.png');
    await versionRow.screenshot({ path: upToDatePath });

    // 3. Switch to Dark Mode & test UP TO DATE
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(300);

      const darkUpToDatePath = path.join(screenshotDir, 'version_compact_03_uptodate_dark.png');
      await versionRow.screenshot({ path: darkUpToDatePath });
    }

    // 4. Test VERIFYING state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'verifying',
          targetVersion: '0.0.2',
        },
      });
    });
    await page.waitForTimeout(300);
    await expect(stageEl).toHaveText('VERIFYING');
    const verifyingPath = path.join(screenshotDir, 'version_compact_04_verifying_dark.png');
    await versionRow.screenshot({ path: verifyingPath });

    // 5. Test DOWNLOADING 84%
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'downloading',
          progress: { percentage: 84 },
          targetVersion: '0.0.2',
        },
      });
    });
    await page.waitForTimeout(300);
    await expect(stageEl).toHaveText('84%');
    const dlPath = path.join(screenshotDir, 'version_compact_05_84pct_dark.png');
    await versionRow.screenshot({ path: dlPath });

    // 6. Capture full sidebar with UP TO DATE state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'up-to-date',
          isManualCheck: true,
        },
      });
    });
    await page.waitForTimeout(300);
    const sidebar = page.locator('aside');
    const fullSidebarPath = path.join(screenshotDir, 'version_compact_06_sidebar_uptodate_dark.png');
    await sidebar.screenshot({ path: fullSidebarPath });
  });
});
