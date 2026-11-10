import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Auto-Shutdown Lifecycle & Zero-Corruption Safety Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Auto-Shutdown toggle on download card: arms and disarms with visual feedback', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock 50 GB Tulsa King in-progress download
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'tulsa-king-50gb',
          url: 'https://fastcdn.example.org/Tulsa.King.S01.50GB.mkv',
          filename: 'Tulsa King S01 1080p BluRay REMUX (50.0 GB).mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Tulsa King S01 1080p BluRay REMUX (50.0 GB).mkv',
          total_bytes: 53687091200, // 50 GB
          downloaded_bytes: 42949672960, // 40 GB (80%)
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 25000000,
          eta_seconds: 420,
          created_at: Date.now() - 1800000,
          updated_at: Date.now(),
          supports_ranges: true,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const card = page.locator('div.rounded-xl', { hasText: 'Tulsa King S01' });
    await expect(card).toBeVisible();

    const toggleBtn = page.locator('[data-testid="auto-shutdown-toggle-tulsa-king-50gb"]');
    await expect(toggleBtn).toBeVisible();

    // 1. Initial State: Unarmed
    await expect(toggleBtn).toHaveText(/Auto-Shutdown/);

    // 2. Click to Turn ON
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(/Shut down when done/);
    await expect(toggleBtn).toHaveClass(/border-rose-500/);

    // 3. Click again to Disarm
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(/Auto-Shutdown/);

    expect(errors).toEqual([]);
  });

  test('30-Second Safety Countdown Modal: displays file verification, ticks down, and aborts cleanly on Cancel', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Trigger shutdown countdown event in browser environment
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-shutdown-tick', {
          detail: {
            seconds_left: 30,
            task_id: 'tulsa-king-50gb',
            filename: 'Tulsa King S01 1080p BluRay REMUX (50.0 GB).mkv',
            total_bytes: 53687091200,
          },
        })
      );
    });

    const modal = page.locator('[data-testid="shutdown-countdown-modal"]');
    await expect(modal).toBeVisible();

    // Verify modal headers and metadata
    await expect(modal.getByText('SHUTDOWN SCHEDULED')).toBeVisible();
    await expect(modal.getByText('Tulsa King S01 1080p BluRay REMUX (50.0 GB).mkv')).toBeVisible();
    await expect(modal.getByText('NTFS Synced & Closed')).toBeVisible();
    await expect(modal.getByText('30')).toBeVisible();

    // Simulate countdown tick to 25s
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-shutdown-tick', {
          detail: {
            seconds_left: 25,
            task_id: 'tulsa-king-50gb',
            filename: 'Tulsa King S01 1080p BluRay REMUX (50.0 GB).mkv',
            total_bytes: 53687091200,
          },
        })
      );
    });
    await expect(modal.getByText('25')).toBeVisible();

    // Click Cancel / Stay On button
    const cancelBtn = modal.locator('[data-testid="cancel-shutdown-btn"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Modal disappears cleanly
    await expect(modal).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Immediate Shutdown button: triggers shutdown action and closes modal cleanly', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-shutdown-tick', {
          detail: {
            seconds_left: 15,
            task_id: 'test-file-large',
            filename: 'BigData.iso',
            total_bytes: 21474836480,
          },
        })
      );
    });

    const modal = page.locator('[data-testid="shutdown-countdown-modal"]');
    await expect(modal).toBeVisible();

    const shutdownNowBtn = modal.locator('[data-testid="shutdown-now-btn"]');
    await expect(shutdownNowBtn).toBeVisible();
    await shutdownNowBtn.click();

    // Modal closes safely
    await expect(modal).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});

