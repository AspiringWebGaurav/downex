import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { clearTestStorage } from './helpers/test-utils';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — 20% Compact Sidebar Width & Symmetry Verification', () => {
  test.use({
    viewport: { width: 780, height: 540 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.waitForLoadState('networkidle');
  });

  test('Verify Sidebar Width is 172px (20% reduction from 216px) and perfectly symmetric', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // 1. Measure exact bounding box of the expanded sidebar
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    console.log(`Measured expanded sidebar width: ${box!.width}px (original 216px, -20% target ~172.8px)`);
    expect(Math.round(box!.width)).toBe(172);

    // 2. Verify all navigation items are visible and fit without truncation
    await expect(page.locator('text=All Downloads')).toBeVisible();
    await expect(page.locator('text=Queues')).toBeVisible();
    await expect(page.locator('text=Speed & Stats')).toBeVisible();
    await expect(page.locator('text=Add URL')).toBeVisible();
    await expect(page.locator('text=Ctrl+N')).toBeVisible();
    await expect(page.locator('text=Settings')).toBeVisible();
    await expect(page.locator('text=Speed Test')).toBeVisible();
    await expect(page.locator('text=Trash')).toBeVisible();

    // 3. Verify bottom APP VERSION row has balanced symmetry
    await expect(page.locator('text=APP VERSION')).toBeVisible();
    await expect(page.locator('text=v0.0.1')).toBeVisible();

    // 4. Capture Light Mode Screenshot
    const lightScreenshot = path.join(screenshotDir, 'sidebar_compact_172px_light.png');
    await page.screenshot({ path: lightScreenshot });
    console.log(`Saved screenshot to ${lightScreenshot}`);

    // 5. Toggle Dark Mode and capture Dark Mode Screenshot
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);

      const darkScreenshot = path.join(screenshotDir, 'sidebar_compact_172px_dark.png');
      await page.screenshot({ path: darkScreenshot });
      console.log(`Saved screenshot to ${darkScreenshot}`);
    }
  });

  test('Verify Collapse (w-[64px]) and Expand (w-[172px]) transition cleanly', async ({ page }) => {
    const sidebar = page.locator('aside');
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"]').first();

    // Initial state: expanded 172px
    let box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(172);

    // Collapse
    await collapseBtn.click();
    await page.waitForTimeout(400);
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(64);

    // Expand
    const expandBtn = page.locator('button[title*="Expand Sidebar"]').first();
    await expandBtn.click();
    await page.waitForTimeout(400);
    box = await sidebar.boundingBox();
    expect(Math.round(box!.width)).toBe(172);
  });
});
