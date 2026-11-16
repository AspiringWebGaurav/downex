import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Dynamic Delete Button Lifecycle (Safety Guard & IDM UX)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Delete button is disabled while downloading, shows hint on attempt, enables on pause, and completes deletion', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock an active downloading item
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'dl-dynamic-delete-test',
          url: 'https://cdn.example.org/active-stream.iso',
          filename: 'active-stream.iso',
          destination_path: 'C:\\Downloads\\active-stream.iso',
          total_bytes: 4000000000,
          downloaded_bytes: 1200000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 15000000,
          eta_seconds: 180,
          created_at: Date.now() - 60000,
          updated_at: Date.now(),
          supports_ranges: true,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'active-stream.iso' });
    await expect(card).toBeVisible();

    const deleteBtn = card.locator('[data-testid="delete-btn-dl-dynamic-delete-test"]');
    const pauseBtn = card.locator('button', { hasText: 'Pause' });

    // 1. WHILE DOWNLOADING: Delete button MUST BE DISABLED
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
    await expect(deleteBtn).toHaveAttribute('title', /Cannot delete while downloading/i);

    // 2. Click disabled button: triggers Pause First guidance micro-pill
    await deleteBtn.click({ force: true });
    const hint = card.locator('[data-testid="pause-first-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/Pause first to delete/i);

    // 3. PAUSE DOWNLOAD: Delete button dynamically BECOMES ENABLED
    await pauseBtn.click();
    await expect(card.locator('button', { hasText: 'Resume' })).toBeVisible();
    await expect(deleteBtn).toBeEnabled();
    await expect(deleteBtn).toHaveAttribute('title', 'Delete download');

    // 4. CLICK ENABLED DELETE BUTTON: Opens Delete Confirmation Modal
    await deleteBtn.click();
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Delete.' })).toBeVisible();

    // 5. Confirm deletion from list
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await confirmBtn.click();

    // Card is instantly removed
    await expect(card).not.toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Completed download has enabled Delete button and can be deleted immediately', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock a completed download
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'dl-completed-delete-test',
          url: 'https://cdn.example.org/completed-package.zip',
          filename: 'completed-package.zip',
          destination_path: 'C:\\Downloads\\completed-package.zip',
          total_bytes: 85000000,
          downloaded_bytes: 85000000,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          eta_seconds: 0,
          created_at: Date.now() - 120000,
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'completed-package.zip' });
    await expect(card).toBeVisible();

    // Completed item has ENABLED Delete button
    const deleteBtn = card.locator('[data-testid="delete-btn-dl-completed-delete-test"]');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();

    // Clicking Delete opens modal directly
    await deleteBtn.click();
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();

    // Confirm deletion
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await confirmBtn.click();

    await expect(card).not.toBeVisible();
    expect(errors).toEqual([]);
  });
});
