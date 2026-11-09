import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Large File Transfer, Connecting State & Smooth Deletion Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('36.6 GB file connecting phase: displays "CONNECTING...", "Connecting to server...", and "Please wait, connecting with server..." without getting stuck in calculating', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock 36.6 GB file at 0 bytes (exact scenario from user screenshot)
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'large-remux-36gb',
          url: 'https://cdn.example.org/Tulsa.King.S01.1080p.BluRay.REMUX.AVC.mkv',
          filename: 'Tulsa King S01 1080p BluRay REMUX AVC [Hindi DDP 2.0 + Englis...mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Tulsa King S01 1080p BluRay REMUX AVC.mkv',
          total_bytes: 39300000000, // ~36.6 GB
          downloaded_bytes: 0,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 0, // Initial socket connection phase
          eta_seconds: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'Tulsa King S01' });
    await expect(card).toBeVisible();

    // 1. Verify Status Badge shows amber animated "CONNECTING..." instead of misleading "DOWNLOADING"
    await expect(card.getByText('CONNECTING...')).toBeVisible();

    // 2. Verify Transfer Rate shows friendly "Connecting to server..." instead of abrupt "0 B/s (0 Mbps)"
    const rateEl = card.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(rateEl).toHaveText('Connecting to server...');

    // 3. Verify Time Left shows reassuring message "Please wait, connecting with server..." instead of stuck "Calculating..."
    const timeLeftEl = card.locator('div:has(> span:text-is("Time left"))').locator('span').nth(1);
    await expect(timeLeftEl).toHaveText('Please wait, connecting with server...');

    expect(errors).toEqual([]);
  });

  test('Transition from connecting to active data streaming: updates to live speed and ETA', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock active stream with 15 MB/s throughput
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'large-remux-36gb-active',
          url: 'https://cdn.example.org/Tulsa.King.S01.1080p.BluRay.REMUX.AVC.mkv',
          filename: 'Tulsa King S01 1080p BluRay REMUX AVC [Hindi DDP 2.0 + Englis...mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Tulsa King S01 1080p BluRay REMUX AVC.mkv',
          total_bytes: 39300000000,
          downloaded_bytes: 524288000, // 500 MB in
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 15728640, // ~15 MB/s
          eta_seconds: 2470,
          created_at: Date.now() - 35000,
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'Tulsa King S01' });
    await expect(card).toBeVisible();

    // Badge transitions to blue DOWNLOADING
    await expect(card.getByText('DOWNLOADING')).toBeVisible();

    // Transfer rate displays real throughput
    const rateEl = card.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    const rateText = await rateEl.innerText();
    expect(rateText).toContain('15 MB/s');

    expect(errors).toEqual([]);
  });

  test('Instant zero-lag deletion of large in-progress task from UI', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'large-remux-to-delete',
          url: 'https://cdn.example.org/Tulsa.King.S01.1080p.BluRay.REMUX.AVC.mkv',
          filename: 'Tulsa King S01 1080p BluRay REMUX AVC [Hindi DDP 2.0 + Englis...mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Tulsa King S01 1080p BluRay REMUX AVC.mkv',
          total_bytes: 39300000000,
          downloaded_bytes: 120000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 0,
          eta_seconds: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const heading = page.getByRole('heading', { name: 'Tulsa King S01' });
    await expect(heading).toBeVisible();

    // Click Delete
    const deleteBtn = page.getByRole('button', { name: 'Delete', exact: true }).first();
    await deleteBtn.click();

    // Modal appears
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();

    // Toggle disk deletion
    const diskToggle = page.locator('[data-testid="delete-from-disk-toggle"]');
    await diskToggle.click();
    await expect(page.getByText('PERMANENT WIPE', { exact: true })).toBeVisible();

    // Confirm deletion
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await confirmBtn.click();

    // Card vanishes immediately with optimistic UI update
    await expect(heading).not.toBeVisible();
    await expect(page.locator('text=No downloads found')).toBeVisible();

    expect(errors).toEqual([]);
  });
});

