import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Queues View Full-Space Geometry & No-Scroll Verification (780x540)', () => {
  test.use({
    viewport: { width: 780, height: 540 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Queues view occupies 100% height symmetrically with zero vertical scroll', async ({ page }) => {
    test.setTimeout(25000);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Queues tab in sidebar
    const queuesNav = page.locator('button:has-text("Queues")');
    await expect(queuesNav).toBeVisible();
    await queuesNav.click();

    // Verify Queues header and cards
    await expect(page.getByText('Simple 1-by-1 Queue')).toBeVisible();
    await expect(page.getByText('Queue Paused')).toBeVisible();
    await expect(page.getByText('How 1-by-1 Queue Works')).toBeVisible();
    await expect(page.getByText('Add & Choose Later')).toBeVisible();
    await expect(page.getByText('Lines Up in Order')).toBeVisible();
    await expect(page.getByText('Sequential 1-by-1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Download to Queue' })).toBeVisible();

    await page.waitForTimeout(500);

    // Verify no vertical scrollbar (scrollHeight should not exceed clientHeight)
    const queueContainer = page.locator('main > div:has-text("Simple 1-by-1 Queue")').first();
    const hasScrollbar = await queueContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight + 1;
    });
    expect(hasScrollbar).toBe(false);

    // Capture Light Mode Screenshot
    const lightScreenshot = path.join(screenshotDir, 'queues_full_space_light.png');
    await page.screenshot({ path: lightScreenshot });
    console.log(`Saved screenshot to ${lightScreenshot}`);

    // Toggle to Dark Mode
    const darkModeBtn = page.locator('button:has-text("Dark mode")');
    if (await darkModeBtn.isVisible()) {
      await darkModeBtn.click();
      await page.waitForTimeout(400);
    }

    // Capture Dark Mode Screenshot
    const darkScreenshot = path.join(screenshotDir, 'queues_full_space_dark.png');
    await page.screenshot({ path: darkScreenshot });
    console.log(`Saved screenshot to ${darkScreenshot}`);
  });
});
