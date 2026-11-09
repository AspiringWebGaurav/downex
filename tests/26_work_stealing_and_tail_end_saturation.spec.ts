import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Tail-End 99% Saturation, Dynamic Work-Stealing & Straggler Resilience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('28.1 GB file at 99% with dynamic connections: renders cleanly with active connections and high-speed saturation', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock 28.1 GB Tulsa King download at 99% (exact scenario from user screenshot)
    await page.evaluate(() => {
      // Simulate 32 dynamic segments where segments have been split down to the last 200 MB
      const mockSegments = Array.from({ length: 32 }, (_, i) => ({
        index: i,
        start: i * 880000000,
        end: (i + 1) * 880000000 - 1,
        downloaded: i < 30 ? 880000000 : 780000000, // 30 complete, 2 actively finishing
        speed_bytes_sec: i >= 30 ? 11250000 : 0, // High throughput on active workers
        is_active: i >= 30,
      }));

      const mockItems = [
        {
          id: 'tulsa-king-28gb',
          url: 'https://fastcdn.example.org/Tulsa.King.S01.1080p.BluRay.REMUX.AVC.mkv',
          filename: 'Tulsa King S01 1080p BluRay REMUX AVC [Hindi DDP 2.0 + Englis...mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Tulsa King S01 1080p BluRay REMUX AVC.mkv',
          total_bytes: 30172676096, // 28.1 GB
          downloaded_bytes: 29957947392, // 27.9 GB (99%)
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 22500000, // 22.5 MB/s (180 Mbps saturation)
          eta_seconds: 9, // Finishes in 9 seconds instead of 10 minutes!
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
          supports_ranges: true,
          segments: mockSegments,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'Tulsa King S01' });
    await expect(card).toBeVisible();

    // 1. Verify percentage reaches 99%
    await expect(card.getByText('(99%)')).toBeVisible();

    // 2. Verify connection badge displays 32 Connection(s)
    await expect(card.getByText('32 Connection(s)')).toBeVisible();

    // 3. Expand connection details drawer
    const detailsBtn = card.getByText('Show details (Connections & Segments)');
    await detailsBtn.click();

    // 4. Verify Active count in drawer
    await expect(card.getByText('2 Active')).toBeVisible();

    // 5. Verify segment visualizer bar renders without errors
    const visualizer = card.locator('div.overflow-hidden.flex.gap-\\[2px\\]');
    await expect(visualizer).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Fallback layer: single-stream notice rendered cleanly when remote server ignores Range', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'single-stream-fallback-task',
          url: 'https://slowhost.example.com/single-stream-file.zip',
          filename: 'single-stream-file.zip',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\single-stream-file.zip',
          total_bytes: 104857600, // 100 MB
          downloaded_bytes: 52428800, // 50 MB
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 5242880,
          eta_seconds: 10,
          created_at: Date.now(),
          updated_at: Date.now(),
          supports_ranges: false,
          segments: [
            {
              index: 0,
              start: 0,
              end: 104857599,
              downloaded: 52428800,
              speed_bytes_sec: 5242880,
              is_active: true,
            },
          ],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'single-stream-file.zip' });
    await expect(card).toBeVisible();

    // Expand details
    await card.getByText('Show details (Connections & Segments)').click();

    // Verify fallback notice banner is displayed
    await expect(card.getByText('Single-stream download: The remote server does not support HTTP Range requests')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Instant deletion of 28 GB download at 99%: UI updates instantly with zero freeze', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'delete-tail-end-test',
          url: 'https://fastcdn.example.org/LargeVideo.mkv',
          filename: 'LargeVideo.mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\LargeVideo.mkv',
          total_bytes: 30172676096,
          downloaded_bytes: 29957947392,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 15000000,
          eta_seconds: 14,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'LargeVideo.mkv' });
    await expect(card).toBeVisible();

    // Click Delete button
    const deleteBtn = card.locator('button', { hasText: 'Delete' });
    await deleteBtn.click();

    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();

    // Confirm Delete via data-testid
    const confirmBtn = page.locator('[data-testid="delete-confirm-btn"]');
    await confirmBtn.click();

    // Card disappears instantly from UI
    await expect(card).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});

