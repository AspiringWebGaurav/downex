import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — New Download Modal UI Synchronization (780x540)', () => {
  test.use({
    viewport: { width: 780, height: 540 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Capture Compact Synchronized New Download Modal at 780x540', async ({ page }) => {
    test.setTimeout(25000);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. Click New Download to open modal
    const newDownloadBtn = page.locator('button:has-text("New Download")');
    await expect(newDownloadBtn).toBeVisible();
    await newDownloadBtn.click();

    // Verify modal is visible
    await expect(page.getByText('NEW DOWNLOAD', { exact: true })).toBeVisible();
    await expect(page.getByText('File Name', { exact: true })).toBeVisible();
    await expect(page.getByText('Save To', { exact: true })).toBeVisible();

    await page.waitForTimeout(500);

    // Capture Light Mode Modal
    const lightModal = path.join(screenshotDir, 'new_download_modal_light.png');
    await page.screenshot({ path: lightModal });

    // Close modal
    const cancelBtn = page.locator('button:has-text("Cancel")');
    await cancelBtn.click();
    await page.waitForTimeout(300);

    // Switch to Dark Mode
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);

      // Reopen modal in Dark Mode
      await newDownloadBtn.click();
      await expect(page.getByText('NEW DOWNLOAD', { exact: true })).toBeVisible();
      await page.waitForTimeout(500);

      // Capture Dark Mode Modal
      const darkModal = path.join(screenshotDir, 'new_download_modal_dark.png');
      await page.screenshot({ path: darkModal });

      // Cleanly close modal & switch back to Light mode
      await cancelBtn.click();
      await page.waitForTimeout(300);
      await darkToggle.click();
      await page.waitForTimeout(300);
    }
  });
});
