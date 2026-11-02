import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Delete Modal Polish & Disk Selection Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Delete modal displays polished modern typography, file stats, and toggle states (before and after select from disk)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    // Seed mock active download
    await page.evaluate(() => {
      localStorage.setItem('downex_delete_from_disk_pref', 'false');
      const mockItems = [
        {
          id: 'delete-modal-test-1',
          url: 'https://cdn.example.org/downex-browser-extension.zip',
          filename: 'downex-browser-extension.zip',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\downex-browser-extension.zip',
          total_bytes: 20070,
          downloaded_bytes: 20070,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          eta_seconds: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify item is visible
    await expect(page.getByRole('heading', { name: 'downex-browser-extension.zip' })).toBeVisible();

    // Click delete button
    const deleteBtn = page.getByRole('button', { name: 'Delete download...', exact: true }).first();
    await deleteBtn.click();

    // Verify modal is visible
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();

    // 1. Header Typography & Subtitle
    await expect(modal.getByRole('heading', { name: 'Delete.' })).toBeVisible();
    await expect(modal.getByText('Remove download task from Downex.')).toBeVisible();

    // 2. Monospace Stats (Matching Image 2 Metric Header)
    await expect(modal.getByText(/100% Complete/i)).toBeVisible();

    // 3. BEFORE SELECT FROM DISK (Unchecked default state)
    const toggleCard = page.locator('[data-testid="delete-from-disk-toggle"]');
    await expect(toggleCard).toBeVisible();
    await expect(modal.getByText('OPTIONAL')).toBeVisible();
    await expect(modal.getByText(/Safe mode:/i)).toBeVisible();

    // Confirm button shows 'REMOVE FROM LIST'
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await expect(confirmBtn).toHaveText(/REMOVE FROM LIST/i);

    // 4. AFTER SELECT FROM DISK (Click to toggle on)
    await toggleCard.click();

    // Card transitions to warning state
    await expect(modal.getByText('PERMANENT WIPE', { exact: true })).toBeVisible();
    await expect(modal.getByText(/Permanent wipe:/i)).toBeVisible();

    // Confirm button updates to 'DELETE FROM DEVICE'
    await expect(confirmBtn).toHaveText(/DELETE FROM DEVICE/i);

    // 5. Toggle back OFF to verify reversible smoothness
    await toggleCard.click();
    await expect(modal.getByText('OPTIONAL')).toBeVisible();
    await expect(modal.getByText(/Safe mode:/i)).toBeVisible();
    await expect(confirmBtn).toHaveText(/REMOVE FROM LIST/i);

    // 6. Cancel closes modal cleanly
    const cancelBtn = page.locator('[data-testid="delete-cancel-btn"]');
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();
  });
});
