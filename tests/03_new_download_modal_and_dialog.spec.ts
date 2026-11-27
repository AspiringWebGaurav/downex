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

    // Open modal via Top Bar or Sidebar button
    await page.click('button:has-text("New Download")');
    const modalTitle = page.getByText('NEW DOWNLOAD', { exact: true });
    await expect(modalTitle).toBeVisible();

    // The modal was opened without prefilled URL: Start and Later buttons should be disabled
    const startBtn = page.locator('button:has-text("Start Download")');
    const laterBtn = page.locator('button:has-text("Later")');
    await expect(startBtn).toBeDisabled();
    await expect(laterBtn).toBeDisabled();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modalTitle).not.toBeVisible();

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

    await expect(modalTitle).toBeVisible();
    const filenameInput = page.locator('input[placeholder="Filename"]');
    await expect(filenameInput).toHaveValue('custom-package');

    // Remember folder must start unchecked so manual per-download folders don't stick globally
    const rememberCheckbox = page.locator('label:has-text("Remember folder") input[type="checkbox"]');
    await expect(rememberCheckbox).not.toBeChecked();

    // Test editing filename
    await filenameInput.fill('renamed-package');
    await expect(filenameInput).toHaveValue('renamed-package');

    // Test Browse button and verify Default reset restores C:\Downloads\Downex
    const destInput = page.locator('input[placeholder="Destination folder path"]');
    await destInput.fill('D:\\');
    const useDefaultBtn = page.locator('[data-testid="use-default-folder-btn"]');
    await expect(useDefaultBtn).toBeEnabled();
    await useDefaultBtn.click();
    await expect(destInput).toHaveValue('C:\\Downloads\\Downex');
    await expect(useDefaultBtn).toBeDisabled();

    const browseBtn = page.locator('button:has-text("Browse")').first();
    await browseBtn.click();
    // Folder modal opens
    await expect(page.locator('text=SAVE DESTINATION')).toBeVisible();
    // Click Select Folder to confirm
    await page.click('button:has-text("SELECT FOLDER")');
    await expect(page.locator('text=SAVE DESTINATION')).not.toBeVisible();

    // Test "Later" button (Enqueue)
    await expect(laterBtn).toBeEnabled();
    await laterBtn.click();

    // Modal closes
    await expect(modalTitle).not.toBeVisible();

    // In the dedicated Queues environment, enqueued download is displayed in Queues
    await expect(page.locator('div.rounded-xl', { hasText: 'renamed-package.iso' })).toBeVisible();
    await expect(page.getByText('QUEUED', { exact: true })).toBeVisible();

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

    const modalTitle = page.getByText('NEW DOWNLOAD', { exact: true });
    await expect(modalTitle).toBeVisible();

    // Click Start Download
    const startBtn = page.locator('button:has-text("Start Download")');
    await startBtn.click();

    // Modal closes
    await expect(modalTitle).not.toBeVisible();

    // Item appears in download table as downloading
    await expect(page.locator('div.rounded-xl', { hasText: 'archive-2026.zip' })).toBeVisible();
    await expect(page.getByText('DOWNLOADING', { exact: true })).toBeVisible();
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
    await expect(page.getByText('NEW DOWNLOAD', { exact: true })).toBeVisible();
    await expect(page.locator('input[placeholder="Filename"]')).toHaveValue('ubuntu-26.04-desktop-amd64');
    await expect(page.locator('text=/RESUME OK/')).toBeVisible();
    await expect(page.getByText('2.00 GB', { exact: true })).toBeVisible();
    await expect(page.locator('text=/32 Threads/')).toBeVisible();

    // Verify Copy URL button
    const copyUrlBtn = page.locator('button:has-text("COPY")').first();
    await expect(copyUrlBtn).toBeVisible();
    await copyUrlBtn.click();
    await expect(page.locator('button:has-text("COPIED")').first()).toBeVisible();

    // Verify Browse button opens unified FolderChangeModal on Download Dialog and updates destination folder
    const card = page.getByTestId('download-dialog-card');
    const startBtn = page.getByRole('button', { name: 'Start Download' });
    const cardBox = await card.boundingBox();
    const startBox = await startBtn.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(startBox).not.toBeNull();
    if (cardBox && startBox) {
      const bottomClearance = cardBox.y + cardBox.height - (startBox.y + startBox.height);
      expect(bottomClearance).toBeGreaterThanOrEqual(8);
    }
    const hasVerticalOverflow = await card.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(hasVerticalOverflow).toBe(false);

    const browseBtn = page.locator('button:has-text("Browse")').first();
    await browseBtn.click();
    const folderModal = page.locator('[data-testid="folder-change-modal"]');
    await expect(folderModal).toBeVisible();
    await expect(folderModal.getByText('SAVE DESTINATION', { exact: true })).toBeVisible();
    await folderModal.locator('[data-testid="folder-shortcut-downloads"]').click();
    await folderModal.locator('[data-testid="folder-change-confirm-btn"]').click();
    await expect(folderModal).not.toBeVisible();
    await expect(page.locator('input[placeholder*="Destination folder path"]')).toHaveValue(/Downloads/);

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

  test('Grabber Dialog (?window=download_dialog): Remember folder defaults false, manual D:\\ does not persist, Default restores system path', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.addInitScript(() => {
      // Simulate an earlier accidental D:\ persistence from a previous build
      localStorage.setItem('downex_default_dir', 'D:\\');
      (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__ = {
        url: 'https://cdn.example.org/Hanuman.Ansh.2026.1080p.mkv',
        filename: 'Hanuman.Ansh.2026.1080p.mkv',
        total_bytes: 9373000000,
        supports_ranges: false,
      };
    });

    await page.goto('/?window=download_dialog');
    await expect(page.getByText('NEW DOWNLOAD', { exact: true })).toBeVisible();

    const rememberCheckbox = page.locator('label:has-text("Remember folder") input[type="checkbox"]');
    await expect(rememberCheckbox).not.toBeChecked();

    const destInput = page.locator('input[placeholder="Destination folder path"]');
    await expect(destInput).toHaveValue('D:\\');

    // Default button is active when path differs from system default and resets persisted D:\
    const useDefaultBtn = page.locator('[data-testid="use-default-folder-btn"]');
    await expect(useDefaultBtn).toBeEnabled();
    await useDefaultBtn.click();
    await expect(destInput).toHaveValue('C:\\Downloads\\Downex');
    await expect(useDefaultBtn).toBeDisabled();

    const persistedAfterReset = await page.evaluate(() => localStorage.getItem('downex_default_dir'));
    expect(persistedAfterReset).toBe('C:\\Downloads\\Downex');

    // Changing manually to D:\ without checking Remember folder must NOT overwrite default
    await destInput.fill('D:\\');
    await expect(useDefaultBtn).toBeEnabled();
    await page.click('button:has-text("Start Download")');

    const persistedAfterManualDownload = await page.evaluate(() => localStorage.getItem('downex_default_dir'));
    expect(persistedAfterManualDownload).toBe('C:\\Downloads\\Downex');

    expect(errors).toEqual([]);
  });
});
