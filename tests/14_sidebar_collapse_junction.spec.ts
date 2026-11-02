import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Sidebar Collapse Button at Header Junction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('Sidebar collapse button is fully visible, not cut off at junction, and toggles cleanly', async ({ page }) => {
    // 1. Locate collapse button
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"], button[title*="Expand Sidebar"]');
    await expect(collapseBtn).toBeVisible();

    // 2. Measure geometry of the collapse button
    const box = await collapseBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Button should be 20px by 20px (w-5 h-5)
      expect(box.width).toBeCloseTo(20, 1);
      expect(box.height).toBeCloseTo(20, 1);

      // Verify that top of the button extends above the 48px header line (junction straddle: y ~ 38px)
      // Header is 48px high. Top of button is at 48 - 10 = 38px.
      expect(box.y).toBeCloseTo(38, 2);
    }

    // 3. Take screenshot of junction area for visual verification
    await page.screenshot({ path: 'test-results/sidebar-junction-expanded.png' });

    // 4. Test clicking to collapse sidebar
    await collapseBtn.click();
    await page.waitForTimeout(350);

    // Verify sidebar has collapsed class/width
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/w-14/);

    // Verify collapse button is still fully visible and centered
    await expect(collapseBtn).toBeVisible();
    const collapsedBox = await collapseBtn.boundingBox();
    expect(collapsedBox).not.toBeNull();
    if (collapsedBox) {
      expect(collapsedBox.width).toBeCloseTo(20, 1);
      expect(collapsedBox.height).toBeCloseTo(20, 1);
      expect(collapsedBox.y).toBeCloseTo(38, 2);
      expect(collapsedBox.x).toBeGreaterThan(40);
      expect(collapsedBox.x).toBeLessThan(50);
    }

    await page.screenshot({ path: 'test-results/sidebar-junction-collapsed.png' });

    // 5. Test clicking again to expand sidebar
    await collapseBtn.click();
    await expect(sidebar).toHaveClass(/w-\[196px\]/);
  });
});
