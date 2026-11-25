import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { clearTestStorage } from './helpers/test-utils';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Delete Modal Polish & Disk Selection Lifecycle', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Delete modal displays polished modern typography, file stats, and toggle states (before and after select from disk)', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });

    // Seed mock active download
    await page.evaluate(() => {
      localStorage.setItem('downex_delete_from_disk_pref', 'false');
      const mockItems = [
        {
          id: 'delete-modal-test-1',
          url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: 4831838208,
          downloaded_bytes: 1304596316,
          status: 'paused',
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
    await expect(page.getByRole('heading', { name: 'ubuntu-24.04-desktop-amd64.iso' })).toBeVisible();

    // Click delete button
    const deleteBtn = page.getByRole('button', { name: 'Delete', exact: true }).first();
    await deleteBtn.click();

    // Verify modal is visible
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();

    // 1. Header Typography & Subtitle
    await expect(modal.getByRole('heading', { name: 'Delete.' })).toBeVisible();
    await expect(modal.getByText('Remove download task from Downex.')).toBeVisible();

    // 2. Monospace Stats (Matching Image 2 Metric Header)
    await expect(modal.getByText(/27% Complete/i)).toBeVisible();

    // 3. BEFORE SELECT FROM DISK (Unchecked default state)
    const toggleCard = page.locator('[data-testid="delete-from-disk-toggle"]');
    await expect(toggleCard).toBeVisible();
    await expect(modal.getByText('OPTIONAL')).toBeVisible();
    await expect(modal.getByText(/Safe mode:/i)).toBeVisible();

    // Confirm button shows 'REMOVE FROM LIST'
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await expect(confirmBtn).toHaveText(/REMOVE FROM LIST/i);

    // Capture Light Mode Modal Screenshot (Unchecked)
    const modalDialog = modal.locator('[data-testid="delete-modal-dialog"]');
    await modalDialog.screenshot({ path: path.join(screenshotDir, 'delete_modal_01_light_safe.png') });

    // 4. AFTER SELECT FROM DISK (Click to toggle on)
    await toggleCard.click();

    // Card transitions to warning state
    await expect(modal.getByText('PERMANENT WIPE', { exact: true })).toBeVisible();
    await expect(modal.getByText(/Permanent wipe:/i)).toBeVisible();

    // Confirm button updates to 'DELETE FROM DEVICE'
    await expect(confirmBtn).toHaveText(/DELETE FROM DEVICE/i);

    // Capture Light Mode Modal Screenshot (Disk Delete Checked)
    await modalDialog.screenshot({ path: path.join(screenshotDir, 'delete_modal_02_light_purge.png') });

    // 5. Toggle back OFF to verify reversible smoothness
    await toggleCard.click();
    await expect(modal.getByText('OPTIONAL')).toBeVisible();
    await expect(modal.getByText(/Safe mode:/i)).toBeVisible();
    await expect(confirmBtn).toHaveText(/REMOVE FROM LIST/i);

    // 6. Switch to Dark Mode and capture
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(150);
    await modalDialog.screenshot({ path: path.join(screenshotDir, 'delete_modal_03_dark_safe.png') });

    // 7. Toggle ON to Permanent Wipe, then cancel
    await toggleCard.click();
    await expect(modal.getByText('PERMANENT WIPE', { exact: true })).toBeVisible();

    const cancelBtn = page.locator('[data-testid="delete-cancel-btn"]');
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();

    // 8. Re-open delete modal: Verify it opens 100% FRESH with checkmark DISABLED (zero persistence)
    await deleteBtn.click();
    await expect(modal).toBeVisible();
    await expect(modal.getByText('OPTIONAL')).toBeVisible();
    await expect(modal.getByText(/Safe mode:/i)).toBeVisible();
    await expect(confirmBtn).toHaveText(/REMOVE FROM LIST/i);
    await expect(modal.getByText('PERMANENT WIPE')).toHaveCount(0);

    // Cancel and clean up
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();
  });
});
