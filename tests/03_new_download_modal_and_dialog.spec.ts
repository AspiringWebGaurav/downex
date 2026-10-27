import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex Base Application — New Download Modal & Grabber Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('NewDownloadModal form inputs, folder picker, and queuing (Download Later)', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Open modal via Top Bar button
    await page.click('button:has-text("New Download")');
    await expect(page.locator('text=Download File')).toBeVisible();

    // The modal was opened without prefilled URL: Start and Later buttons should be disabled
    const startBtn = page.locator('button:has-text("Start Download")');
    const laterBtn = page.locator('button:has-text("Later")');
    await expect(startBtn).toBeDisabled();
    await expect(laterBtn).toBeDisabled();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Download File')).not.toBeVisible();

    // Trigger modal with URL detail event
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-open-new-download', {
          detail: {
            url: 'https://releases.example.com/software-v2.5.iso',
            filename: 'custom-package.iso',
            total_bytes: 524288000,
            supports_ranges: true,
          },
        })
      );
    });

    await expect(page.locator('text=Download File')).toBeVisible();
    const filenameInput = page.locator('input[placeholder="Filename"]');
    await expect(filenameInput).toHaveValue('custom-package');

    // Test editing filename
    await filenameInput.fill('renamed-package');
    await expect(filenameInput).toHaveValue('renamed-package');

    // Test Browse button
    const browseBtn = page.locator('button:has-text("Browse…")');
    await browseBtn.click();
    const folderInput = page.locator('input[placeholder="Destination folder path..."]');
    await expect(folderInput).toHaveValue(/CustomDownexFolder/);

    // Test "Later" button (Enqueue)
    await expect(laterBtn).toBeEnabled();
    await laterBtn.click();

    // Modal closes
    await expect(page.locator('text=Download File')).not.toBeVisible();

    // Check that item is added to the table with queued status
    await expect(page.getByRole('heading', { name: 'renamed-package.iso' })).toBeVisible();
    await expect(page.getByText('queued').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('NewDownloadModal starting active download (Download Now)', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-open-new-download', {
          detail: {
            url: 'https://fast-mirror.net/archive-2026.zip',
            filename: 'archive-2026.zip',
            total_bytes: 104857600,
            supports_ranges: true,
          },
        })
      );
    });

    await expect(page.locator('text=Download File')).toBeVisible();

    // Click Start Download
    const startBtn = page.locator('button:has-text("Start Download")');
    await startBtn.click();

    // Modal closes
    await expect(page.locator('text=Download File')).not.toBeVisible();

    // Item appears in download table as downloading
    await expect(page.getByRole('heading', { name: 'archive-2026.zip' })).toBeVisible();
    await expect(page.locator('text=Downloading')).toBeVisible();
  });

  test('Dedicated Grabber Dialog Window (?window=download_dialog) complete lifecycle', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Provide mock dialog payload before loading window
    await page.addInitScript(() => {
      (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__ = {
        url: 'https://cdn.example.org/ubuntu-26.04-desktop-amd64.iso',
        filename: 'ubuntu-26.04-desktop-amd64.iso',
        total_bytes: 2147483648,
        supports_ranges: true,
        referer: 'https://ubuntu.com/download/desktop',
      };
    });

    await page.goto('/?window=download_dialog');

    // Verify dialog header and probed payload
    await expect(page.locator('text=Download File')).toBeVisible();
    await expect(page.locator('input[placeholder="Filename"]')).toHaveValue('ubuntu-26.04-desktop-amd64');
    await expect(page.locator('text=Resume supported')).toBeVisible();
    await expect(page.getByText('2.00 GB', { exact: true })).toBeVisible();
    await expect(page.locator('text=8 Connections')).toBeVisible();

    // Verify Copy URL button
    const copyUrlBtn = page.locator('button:has-text("Copy URL")');
    await expect(copyUrlBtn).toBeVisible();
    await copyUrlBtn.click();
    await expect(page.locator('text=Copied')).toBeVisible();

    // Verify Browse button
    await page.click('button:has-text("Browse…")');
    await expect(page.locator('input[placeholder="Destination folder path..."]')).toHaveValue(/CustomDownexFolder/);

    // Test submit via Start Download button
    await page.click('button:has-text("Start Download")');

    // Verify download was added to mock storage
    const saved = await page.evaluate(() => {
      const raw = sessionStorage.getItem('downex_mock_downloads');
      return raw ? JSON.parse(raw) : [];
    });

    expect(saved.length).toBeGreaterThan(0);
    expect(saved[0].filename).toBe('ubuntu-26.04-desktop-amd64.iso');

    expect(errors).toEqual([]);
  });
});
