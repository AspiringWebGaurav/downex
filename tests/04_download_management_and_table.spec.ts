import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex Base Application — Download Table, Lifecycles & Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Pause, Resume, and Segment Worker Inspection on active downloads', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock active download with segments
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'worker-dl-1',
          url: 'https://downloads.example.org/large-dataset.tar.gz',
          filename: 'large-dataset.tar.gz',
          destination_path: 'C:\\Downloads\\large-dataset.tar.gz',
          total_bytes: 104857600,
          downloaded_bytes: 41943040,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12582912,
          eta_seconds: 5,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [
            { index: 0, start: 0, end: 26214400, downloaded: 20000000, speed_bytes_sec: 3145728, is_active: true },
            { index: 1, start: 26214400, end: 52428800, downloaded: 15000000, speed_bytes_sec: 3145728, is_active: true },
            { index: 2, start: 52428800, end: 78643200, downloaded: 5000000, speed_bytes_sec: 3145728, is_active: true },
            { index: 3, start: 78643200, end: 104857600, downloaded: 1943040, speed_bytes_sec: 3145728, is_active: true },
          ],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify item is displayed
    await expect(page.getByRole('heading', { name: 'large-dataset.tar.gz' })).toBeVisible();
    await expect(page.getByText('Receiving data...').first()).toBeVisible();

    // 1. Inspect segment worker chunks
    const detailsBtn = page.locator('button:has-text("Show details")').first();
    await detailsBtn.click();

    // Verify segments are expanded
    await expect(page.locator('text=Start positions and download progress by connections')).toBeVisible();
    await expect(page.locator('text=Connection Info')).toBeVisible();

    // Collapse details
    const hideBtn = page.locator('button:has-text("Hide details")').first();
    await hideBtn.click();
    await expect(page.locator('text=Start positions and download progress by connections')).not.toBeVisible();

    // 2. Pause the download
    const pauseBtn = page.locator('button[title="Pause"]').first();
    await pauseBtn.click();

    // Status changes to paused
    await expect(page.getByText('Paused').first()).toBeVisible();

    // 3. Resume the download
    const resumeBtn = page.locator('button[title="Resume"]').first();
    await resumeBtn.click();

    // Status returns to receiving data
    await expect(page.getByText('Receiving data...').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Instant Search Filtering across multiple downloads', async ({ page }) => {
    // Seed 3 mock items
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'item-alpha',
          url: 'https://ex.com/alpha-system.iso',
          filename: 'alpha-system.iso',
          destination_path: 'C:\\Downloads\\alpha-system.iso',
          total_bytes: 80000000,
          downloaded_bytes: 40000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 2000000,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'item-beta',
          url: 'https://ex.com/beta-package.zip',
          filename: 'beta-package.zip',
          destination_path: 'C:\\Downloads\\beta-package.zip',
          total_bytes: 40000000,
          downloaded_bytes: 20000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 1000000,
          created_at: Date.now() + 1,
          updated_at: Date.now() + 1,
        },
        {
          id: 'item-gamma',
          url: 'https://ex.com/gamma-media.mp4',
          filename: 'gamma-media.mp4',
          destination_path: 'C:\\Downloads\\gamma-media.mp4',
          total_bytes: 60000000,
          downloaded_bytes: 60000000,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 2,
          updated_at: Date.now() + 2,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // All 3 visible
    await expect(page.getByRole('heading', { name: 'alpha-system.iso' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'beta-package.zip' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'gamma-media.mp4' })).toBeVisible();

    // Type "beta" in search
    const searchInput = page.locator('#search-input');
    await searchInput.fill('beta');

    // Only beta visible
    await expect(page.getByRole('heading', { name: 'beta-package.zip' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'alpha-system.iso' })).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'gamma-media.mp4' })).not.toBeVisible();

    // Clear search
    await searchInput.fill('');
    await expect(page.getByRole('heading', { name: 'alpha-system.iso' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'beta-package.zip' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'gamma-media.mp4' })).toBeVisible();
  });

  test('Queue runner controls and sequential processing', async ({ page }) => {
    // Seed queued downloads
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'q-item-1',
          url: 'https://ex.com/queued-job-1.zip',
          filename: 'queued-job-1.zip',
          destination_path: 'C:\\Downloads\\queued-job-1.zip',
          total_bytes: 50000000,
          downloaded_bytes: 0,
          status: 'queued',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Switch to Queues view
    await page.click('aside button:has-text("Queues")');
    await expect(page.locator('text=Simple 1-by-1 Queue')).toBeVisible();
    await expect(page.locator('text=Queue Paused')).toBeVisible();

    // Start Queue
    const startQueueBtn = page.locator('button:has-text("Start Queue")');
    await startQueueBtn.click();

    // Queue is active
    await expect(page.locator('text=Queue Active')).toBeVisible();

    // Pause Queue
    const pauseQueueBtn = page.locator('button:has-text("Pause Queue")');
    await pauseQueueBtn.click();
    await expect(page.locator('text=Queue Paused')).toBeVisible();
  });

  test('Delete confirmation modal lifecycle with file cleanup checkbox', async ({ page }) => {
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'del-target-1',
          url: 'https://ex.com/to-delete.dmg',
          filename: 'to-delete.dmg',
          destination_path: 'C:\\Downloads\\to-delete.dmg',
          total_bytes: 75000000,
          downloaded_bytes: 35000000,
          status: 'paused',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Click delete icon button
    const deleteBtn = page.locator('button[title*="Delete download"]').first();
    await deleteBtn.click();

    // Modal appears
    await expect(page.locator('text=Delete Download')).toBeVisible();
    await expect(page.locator('text=to-delete.dmg').first()).toBeVisible();

    // Test Delete File From Disk checkbox
    const diskCheckbox = page.locator('input[type="checkbox"]').first();
    await diskCheckbox.check();
    expect(await diskCheckbox.isChecked()).toBe(true);

    // Cancel deletion first
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('text=Delete Download')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'to-delete.dmg' })).toBeVisible();

    // Open modal again and confirm delete
    await deleteBtn.click();
    await expect(page.locator('text=Delete Download')).toBeVisible();
    await page.locator('button:has-text("Delete from Device"), button:has-text("Remove from List")').click();

    // Item is deleted and table shows empty
    await expect(page.getByRole('heading', { name: 'to-delete.dmg' })).not.toBeVisible();
    await expect(page.locator('text=No downloads found')).toBeVisible();
  });

  test('Dedicated Download Complete Window (?window=download_complete) full lifecycle', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.addInitScript(() => {
      (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__ = {
        id: 'comp-100',
        url: 'https://releases.kernel.org/linux-6.14.tar.xz',
        filename: 'linux-6.14.tar.xz',
        destination_path: 'C:\\Downloads\\Downex\\linux-6.14.tar.xz',
        total_bytes: 146800640,
        downloaded_bytes: 146800640,
      };
    });

    await page.goto('/?window=download_complete');

    // Verify window elements
    await expect(page.getByRole('heading', { name: 'Download complete' })).toBeVisible();
    await expect(page.locator('input').first()).toHaveValue('https://releases.kernel.org/linux-6.14.tar.xz');
    await expect(page.locator('input').nth(1)).toHaveValue('C:\\Downloads\\Downex\\linux-6.14.tar.xz');
    await expect(page.locator('text=140 MB')).toBeVisible();

    // Verify Action buttons: Open, Open Folder, Open With...
    await expect(page.locator('button:has-text("Open")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Open Folder")')).toBeVisible();
    await expect(page.locator('button:has-text("Open with...")')).toBeVisible();

    // Verify "Don't show this dialog again" checkbox
    const dontShowCheckbox = page.locator('input[type="checkbox"]');
    await dontShowCheckbox.check();
    const persistedPref = await page.evaluate(() => localStorage.getItem('downex_dont_show_complete_dialog'));
    expect(persistedPref).toBe('true');

    // Test Esc closes dialog
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  });
});
