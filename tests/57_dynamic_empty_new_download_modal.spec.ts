import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — Dynamic Empty State for New Download Modal', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="sidebar-version"]', { timeout: 15000 });
  });

  test('1. When link is not pasted, File Name is empty, no fake .PDF badge, and size shows waiting', async ({ page }) => {
    // Click "+ Add URL" from sidebar
    const addUrlBtn = page.getByRole('button', { name: /Add URL/i });
    await expect(addUrlBtn).toBeVisible();
    await addUrlBtn.click();

    // Verify Modal Opened
    const modalTitle = page.locator('span:has-text("NEW DOWNLOAD")').first();
    await expect(modalTitle).toBeVisible();

    // Verify Source URL input is empty
    const urlInput = page.locator('input[placeholder*="Paste download link"]');
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue('');

    // Verify File Name input is completely empty
    const fileNameInput = page.locator('div:has(> div > label:has-text("File Name")) input');
    await expect(fileNameInput).toBeVisible();
    await expect(fileNameInput).toHaveValue('');

    // Verify NO fake extension badge (e.g., .PDF or .BIN) is rendered
    const extensionBadge = page.locator('span:has-text(".PDF")');
    await expect(extensionBadge).toHaveCount(0);

    // Verify File Size shows "—" and "WAITING"
    const fileSizeCard = page.locator('div:has-text("File Size")').locator('xpath=..').first();
    await expect(fileSizeCard).toContainText('—');
    await expect(fileSizeCard).toContainText('WAITING');

    // Verify "Start Download" and "Later" are disabled
    const startBtn = page.getByRole('button', { name: 'Start Download', exact: true });
    await expect(startBtn).toBeDisabled();
    const laterBtn = page.getByRole('button', { name: 'Later', exact: true });
    await expect(laterBtn).toBeDisabled();

    // Screenshot empty state in light mode
    await page.screenshot({
      path: path.join(screenshotsDir, 'new_download_empty_state_light.png'),
    });
  });

  test('2. Dynamic URL paste and clear: populates filename & badge on paste, wipes them completely on clear', async ({ page }) => {
    // Open modal via "+ Add URL"
    const addUrlBtn = page.getByRole('button', { name: /Add URL/i });
    await addUrlBtn.click();

    const urlInput = page.locator('input[placeholder*="Paste download link"]');
    const fileNameInput = page.locator('div:has(> div > label:has-text("File Name")) input');

    // Paste a URL with a PDF extension
    await urlInput.fill('https://example.org/quarterly-financial-report.pdf');

    // Dynamically populates filename and .PDF badge
    await expect(fileNameInput).toHaveValue('quarterly-financial-report');
    const pdfBadge = page.locator('span:has-text(".PDF")');
    await expect(pdfBadge).toBeVisible();

    // Buttons should now be enabled
    const startBtn = page.getByRole('button', { name: 'Start Download', exact: true });
    await expect(startBtn).toBeEnabled();

    // Screenshot filled state
    await page.screenshot({
      path: path.join(screenshotsDir, 'new_download_link_pasted_pdf.png'),
    });

    // Now clear the URL input using the clear button
    const clearUrlBtn = page.locator('button[title="Clear URL"]');
    await expect(clearUrlBtn).toBeVisible();
    await clearUrlBtn.click();

    // Source URL is now empty
    await expect(urlInput).toHaveValue('');

    // Dynamically empties File Name, removes .PDF badge, and resets size to waiting
    await expect(fileNameInput).toHaveValue('');
    await expect(page.locator('span:has-text(".PDF")')).toHaveCount(0);
    const fileSizeCard = page.locator('div:has-text("File Size")').locator('xpath=..').first();
    await expect(fileSizeCard).toContainText('—');
    await expect(fileSizeCard).toContainText('WAITING');
    await expect(startBtn).toBeDisabled();

    // Screenshot dynamically cleared state
    await page.screenshot({
      path: path.join(screenshotsDir, 'new_download_cleared_dynamic_empty.png'),
    });
  });
});
