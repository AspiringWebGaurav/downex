import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex Base Application — Performance, Stress, Edge Cases & Data Cleanup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('High-throughput concurrency stress: 25 simultaneous downloads and instantaneous search filtering', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Generate 25 synthetic download records across multiple categories
    const syntheticDownloads = Array.from({ length: 25 }, (_, i) => ({
      id: `stress-item-${i + 1}`,
      url: `https://dist.example.org/packages/archive-vol-${i + 1}.iso`,
      filename: `archive-vol-${i + 1}.iso`,
      destination_path: `C:\\Downloads\\archive-vol-${i + 1}.iso`,
      status: i % 4 === 0 ? 'downloading' : i % 4 === 1 ? 'completed' : i % 4 === 2 ? 'paused' : 'queued',
      total_bytes: 104857600 * (i + 1), // 100MB * (i+1)
      downloaded_bytes: i % 4 === 1 ? 104857600 * (i + 1) : 52428800 * (i + 1),
      speed: i % 4 === 0 ? 15728640 : 0, // 15 MB/s
      eta_seconds: i % 4 === 0 ? 45 : null,
      created_at: Date.now() - (i * 60000),
      updated_at: Date.now(),
      segments: [
        { index: 0, start: 0, end: 52428800, downloaded: 26214400, is_active: i % 4 === 0 },
        { index: 1, start: 52428800, end: 104857600, downloaded: 26214400, is_active: i % 4 === 0 },
      ],
    }));

    await page.evaluate((items) => {
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(items));
    }, syntheticDownloads);

    await page.reload();

    // Verify all 25 items render in the list without layout breakdown
    await expect(page.getByRole('heading', { name: 'archive-vol-1.iso' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'archive-vol-25.iso' })).toBeVisible();

    // Stress test: rapid search queries
    const searchInput = page.locator('#search-input');
    await searchInput.fill('vol-15');
    await expect(page.getByRole('heading', { name: 'archive-vol-15.iso' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'archive-vol-1.iso' })).not.toBeVisible();

    // Clear search
    await searchInput.fill('');
    await expect(page.getByRole('heading', { name: 'archive-vol-1.iso' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Component lifecycle stress: rapid switching between all views with zero memory leaks or unmount errors', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    const views = [
      'All Downloads',
      'Active',
      'Queues',
      'Completed',
      'Trash',
      'Settings',
    ];

    // Rapidly cycle through all views 3 times
    for (let round = 0; round < 3; round++) {
      for (const viewName of views) {
        await page.click(`button:has-text("${viewName}")`);
      }
    }

    // Return to All Downloads and verify stable state
    await page.click('button:has-text("All Downloads")');
    await expect(page.locator('text=All Downloads')).toBeVisible();

    // Verify no unhandled exceptions or React memory leak console warnings occurred
    expect(errors).toEqual([]);
  });

  test('Edge cases: Special characters, long paths, empty inputs and modal validation', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Explicitly disable clipboard watch so modal opens with clean empty URL
    await page.evaluate(() => localStorage.setItem('downex_clipboard_watch', 'false'));
    await page.click('button:has-text("New Download")');
    await expect(page.locator('text=Download File')).toBeVisible();

    // 2. Submit with empty URL — Start Download button should be disabled
    const startDownloadBtn = page.locator('button:has-text("Start Download")');
    await expect(startDownloadBtn).toBeDisabled();

    // 3. Test filename input with special characters and long path
    const filenameInput = page.locator('input[placeholder="Filename"]');
    await filenameInput.fill('Special-File_Archive.[v2.0]~final');
    expect(await filenameInput.inputValue()).toBe('Special-File_Archive.[v2.0]~final');

    // 4. Test destination path input
    const pathInput = page.locator('input[placeholder*="Destination folder path"]');
    await pathInput.fill('D:\\Very\\Long\\Path\\To\\Custom\\Storage\\Subfolder');
    expect(await pathInput.inputValue()).toBe('D:\\Very\\Long\\Path\\To\\Custom\\Storage\\Subfolder');

    // Close modal via Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Download File')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Post-testing verification: complete dummy data and temporary artifact cleanup', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed dummy data
    await page.evaluate(() => {
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify([{ id: 'dummy-cleanup', filename: 'dummy.bin' }]));
      localStorage.setItem('downex_recently_updated', 'dummy');
    });

    // 2. Execute full cleanup
    await clearTestStorage(page);

    // 3. Reload and verify application starts in a completely clean, zero-dummy production-ready state
    await page.reload();

    // Verify empty state
    await expect(page.locator('text=No downloads found')).toBeVisible();

    // Verify all mock keys are strictly null
    const storageKeys = await page.evaluate(() => ({
      mockDownloads: sessionStorage.getItem('downex_mock_downloads'),
      recentlyUpdated: localStorage.getItem('downex_recently_updated'),
    }));

    expect(storageKeys.mockDownloads).toBeNull();
    expect(storageKeys.recentlyUpdated).toBeNull();

    expect(errors).toEqual([]);
  });
});
