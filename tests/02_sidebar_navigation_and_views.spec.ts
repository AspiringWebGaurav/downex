import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex Base Application — Sidebar Navigation & View Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Seamless navigation across all views with accurate view states', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. All Downloads (Default)
    await expect(page.locator('aside button:has-text("All Downloads")')).toHaveClass(/bg-zinc-900|bg-white/);
    await expect(page.locator('text=No downloads found')).toBeVisible();

    // 2. Active View
    await page.click('aside button:has-text("Active")');
    await expect(page.locator('text=No active downloads')).toBeVisible();

    // 3. Queues View
    await page.click('aside button:has-text("Queues")');
    await expect(page.locator('text=Simple 1-by-1 Queue')).toBeVisible();
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible();

    // 4. Completed View
    await page.click('aside button:has-text("Completed")');
    await expect(page.locator('text=No completed downloads')).toBeVisible();

    // 5. Trash View
    await page.click('aside button:has-text("Trash")');
    await expect(page.locator('text=Trash is empty')).toBeVisible();

    // 6. Settings View
    await page.click('aside button:has-text("Settings")');
    await expect(page.locator('h1:has-text("Downex Preferences & System Telemetry")')).toBeVisible();
    // In Settings, Top Search bar should be hidden
    await expect(page.locator('#search-input')).not.toBeVisible();

    // 7. Back to All Downloads
    await page.click('aside button:has-text("All Downloads")');
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('text=No downloads found')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Add URL button in sidebar opens New Download Modal', async ({ page }) => {
    await page.click('aside button:has-text("Add URL")');
    await expect(page.locator('text=Download File')).toBeVisible();
    await expect(page.locator('input[placeholder="Filename"]')).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Download File')).not.toBeVisible();
  });

  test('Sidebar collapse and expand via edge floating pill button', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/w-\[196px\]/);

    // Click the edge collapse arrow
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"], button[title*="Pure View"]').first();
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();

    // Should now be collapsed (w-14)
    await expect(sidebar).toHaveClass(/w-14/);
    const persisted = await page.evaluate(() => localStorage.getItem('downex_sidebar_collapsed'));
    expect(persisted).toBe('true');

    // Reload to verify persistence
    await page.reload();
    await expect(page.locator('aside')).toHaveClass(/w-14/);

    // Click expand arrow
    const expandBtn = page.locator('button[title*="Expand Sidebar"]').first();
    await expandBtn.click();
    await expect(page.locator('aside')).toHaveClass(/w-\[196px\]/);

    const persistedAfter = await page.evaluate(() => localStorage.getItem('downex_sidebar_collapsed'));
    expect(persistedAfter).toBe('false');
  });

  test('Sidebar badges reflect items in various statuses', async ({ page }) => {
    // Inject mock items in various statuses via sessionStorage
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'test-item-1',
          url: 'https://example.com/active.zip',
          filename: 'active.zip',
          destination_path: 'C:\\Downloads\\active.zip',
          total_bytes: 50000000,
          downloaded_bytes: 25000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 5000000,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'test-item-2',
          url: 'https://example.com/queued.zip',
          filename: 'queued.zip',
          destination_path: 'C:\\Downloads\\queued.zip',
          total_bytes: 30000000,
          downloaded_bytes: 0,
          status: 'queued',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 1,
          updated_at: Date.now() + 1,
        },
        {
          id: 'test-item-3',
          url: 'https://example.com/completed.zip',
          filename: 'completed.zip',
          destination_path: 'C:\\Downloads\\completed.zip',
          total_bytes: 10000000,
          downloaded_bytes: 10000000,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 2,
          updated_at: Date.now() + 2,
        },
        {
          id: 'test-item-4',
          url: 'https://example.com/failed.zip',
          filename: 'failed.zip',
          destination_path: 'C:\\Downloads\\failed.zip',
          total_bytes: 15000000,
          downloaded_bytes: 5000000,
          status: 'failed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 3,
          updated_at: Date.now() + 3,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify badges
    // All Downloads: 4
    await expect(page.locator('aside button:has-text("All Downloads")')).toContainText('4');
    // Active: 1
    await expect(page.locator('aside button:has-text("Active")')).toContainText('1');
    // Queues: 1
    await expect(page.locator('aside button:has-text("Queues")')).toContainText('1');
    // Completed: 1
    await expect(page.locator('aside button:has-text("Completed")')).toContainText('1');
    // Trash: 1
    await expect(page.locator('aside button:has-text("Trash")')).toContainText('1');
  });
});
