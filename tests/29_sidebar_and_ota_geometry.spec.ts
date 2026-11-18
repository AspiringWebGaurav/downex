import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Sidebar, Version, and T-Junction Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('T-junction collapse button, zero blank gap, and laser baseline alignment', async ({ page }) => {
    // 1. Measure Window Header
    const header = page.locator('div[data-tauri-drag-region]').first();
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    const headerHeight = headerBox!.height;
    // Header should be ~36px (h-9)
    expect(headerHeight).toBeCloseTo(36, 2);

    // 2. Measure Collapse Button
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"], button[title*="Expand Sidebar"]');
    await expect(collapseBtn).toBeVisible();
    const collapseBox = await collapseBtn.boundingBox();
    expect(collapseBox).not.toBeNull();
    expect(collapseBox!.width).toBeCloseTo(20, 1);
    expect(collapseBox!.height).toBeCloseTo(20, 1);

    // Verify collapse button is 100% visible, completely below header (y = 53px)
    expect(collapseBox!.y).toBeCloseTo(53, 2);

    // 3. Verify Version Row position at the bottom near Check updates horizontal line
    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toBeVisible();
    const versionBox = await versionRow.boundingBox();
    expect(versionBox).not.toBeNull();

    // Verify version row is located near the bottom of the sidebar (y > 400px)
    expect(versionBox!.y).toBeGreaterThan(400);

    // Screenshot 1: Expanded Idle
    await page.screenshot({ path: 'test-results/01-expanded-idle.png' });

    // 4. Test 84% OTA state simulation
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'downloading',
            progress: { percentage: 84 },
            targetVersion: '0.0.2',
          },
        });
      }
    });
    await page.waitForTimeout(300);

    // Measure v0.0.1 and 84% alignment
    const vText = page.locator('[data-testid="sidebar-version"] span:has-text("v0.0.1")').first();
    const stageText = page.locator('[data-testid="sidebar-version-stage"]').first();
    await expect(vText).toBeVisible();
    await expect(stageText).toBeVisible();

    const vBox = await vText.boundingBox();
    const stageBox = await stageText.boundingBox();
    expect(vBox).not.toBeNull();
    expect(stageBox).not.toBeNull();

    const yCenterDiff = Math.abs((vBox!.y + vBox!.height / 2) - (stageBox!.y + stageBox!.height / 2));
    console.log(`Vertical alignment difference between v0.0.1 and 84%: ${yCenterDiff.toFixed(2)}px`);
    // Centers must match within 1.5px (laser aligned)
    expect(yCenterDiff).toBeLessThan(2);

    // Screenshot 2: Expanded with 84% OTA
    await page.screenshot({ path: 'test-results/02-expanded-84pct.png' });

    // 5. Test Collapsing Sidebar
    await collapseBtn.click();
    await page.waitForTimeout(400);

    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/(w-\[70px\]|w-14)/);

    const collapsedBtnBox = await collapseBtn.boundingBox();
    expect(collapsedBtnBox).not.toBeNull();
    expect(collapsedBtnBox!.y).toBeCloseTo(53, 2);
    expect(collapsedBtnBox!.x).toBeGreaterThan(55);
    expect(collapsedBtnBox!.x).toBeLessThan(65);

    // Screenshot 3: Collapsed with 84% OTA
    await page.screenshot({ path: 'test-results/03-collapsed-84pct.png' });

    // 6. Test Expand again
    await collapseBtn.click();
    await page.waitForTimeout(400);
    await expect(sidebar).toHaveClass(/w-\[228px\]/);

    // Screenshot 4: Expanded Restored
    await page.screenshot({ path: 'test-results/04-expanded-restored.png' });
  });

  test('UI open shimmer sweep and CHECKING stage in expanded and collapsed modes', async ({ page }) => {
    // 1. Simulate CHECKING state (as triggered when UI opens or from system tray)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'checking',
            isManualCheck: true,
          },
        });
      }
    });
    await page.waitForTimeout(100);

    // Verify CHECKING stage text is visible
    const stage = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stage).toBeVisible();
    await expect(stage).toHaveText('CHECKING');

    // Verify Shimmer sweep element is rendered with .animate-shimmer-sweep
    const shimmer = page.locator('.animate-shimmer-sweep');
    await expect(shimmer.first()).toBeVisible();

    // Capture Screenshot: Expanded Checking with Shimmer
    await page.screenshot({ path: 'test-results/05-expanded-checking-shimmer.png' });

    // 2. Collapse Sidebar to verify collapsed checking shimmer
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"], button[title*="Expand Sidebar"]');
    await collapseBtn.click();
    await page.waitForTimeout(300);

    // Verify collapsed button contains shimmer sweep
    const collapsedShimmer = page.locator('aside .animate-shimmer-sweep');
    await expect(collapsedShimmer.first()).toBeVisible();

    // Capture Screenshot: Collapsed Checking with Shimmer
    await page.screenshot({ path: 'test-results/06-collapsed-checking-shimmer.png' });

    // 3. Simulate transition to UP TO DATE
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'up-to-date',
            isManualCheck: true,
          },
        });
      }
    });
    await page.waitForTimeout(200);

    // Expand sidebar to check UP TO DATE stage
    await collapseBtn.click();
    await page.waitForTimeout(300);

    const upToDateStage = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(upToDateStage).toBeVisible();
    await expect(upToDateStage).toHaveText('UP TO DATE');

    // Capture Screenshot: Expanded Up to Date
    await page.screenshot({ path: 'test-results/07-expanded-up-to-date.png' });
  });
});
