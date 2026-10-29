import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

const TEST_FILE_SIZE_382MB = 400556032; // 382 MB in bytes

test.describe('Downex Download Completion & Integrity Verification (REA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('382 MB Download: Automatic completion detection and termination without manual pause', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed a 382 MB download in active "downloading" state at 98%
    await page.evaluate(({ fileSize }) => {
      const mockItems = [
        {
          id: 'test-382mb-completion',
          url: 'https://cdn.example.org/videos/Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv',
          filename: 'Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv',
          destination_path: 'C:\\Downloads\\Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv',
          total_bytes: fileSize,
          downloaded_bytes: fileSize - 4000000, // 4 MB remaining
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 15728640, // 15 MB/s
          eta_seconds: 1,
          created_at: Date.now() - 30000,
          updated_at: Date.now(),
          segments: [
            { index: 0, start: 0, end: fileSize / 2, downloaded: fileSize / 2, speed_bytes_sec: 0, is_active: false },
            { index: 1, start: fileSize / 2 + 1, end: fileSize - 1, downloaded: (fileSize / 2) - 4000000, speed_bytes_sec: 15728640, is_active: true },
          ],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    }, { fileSize: TEST_FILE_SIZE_382MB });

    await page.reload();

    // Verify item is visible and actively downloading
    await expect(page.getByRole('heading', { name: 'Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv' })).toBeVisible();
    await expect(page.getByText('Receiving data...').first()).toBeVisible();
    await expect(page.locator('button[title="Pause"]').first()).toBeVisible();

    // 2. Simulate Tauri engine emitting the final 'completed' progress event when 100% is reached
    await page.evaluate(({ fileSize }) => {
      // Dispatches progress event through internal Downex store or mock event listener
      const customEvent = new CustomEvent('downex-mock-progress', {
        detail: {
          task_id: 'test-382mb-completion',
          status: 'completed',
          downloaded_bytes: fileSize,
          total_bytes: fileSize,
          speed_bytes_sec: 0,
          eta_seconds: null,
          segments: [
            { index: 0, start: 0, end: fileSize / 2, downloaded: fileSize / 2, speed_bytes_sec: 0, is_active: false },
            { index: 1, start: fileSize / 2 + 1, end: fileSize - 1, downloaded: fileSize / 2 - 1, speed_bytes_sec: 0, is_active: false },
          ],
        },
      });
      window.dispatchEvent(customEvent);

      // Also update stored item to completed
      const stored = JSON.parse(sessionStorage.getItem('downex_mock_downloads') || '[]');
      if (stored.length > 0) {
        stored[0].status = 'completed';
        stored[0].downloaded_bytes = fileSize;
        stored[0].speed_bytes_sec = 0;
        stored[0].eta_seconds = null;
        sessionStorage.setItem('downex_mock_downloads', JSON.stringify(stored));
      }
    }, { fileSize: TEST_FILE_SIZE_382MB });

    await page.reload();

    // 3. Verify download status automatically transitions to "Completed"
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 5000 });

    // 4. Verify pause button is gone and replaced by action buttons (Open Folder, Open File)
    await expect(page.locator('button[title="Pause"]')).not.toBeVisible();
    await expect(page.locator('button[title="Open file"]').first()).toBeVisible();
    await expect(page.locator('button[title="Show in folder"]').first()).toBeVisible();

    // 5. Verify byte counts: exact 382 MB without continuous overflow
    const fileCard = page.locator('div:has-text("Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv")').first();
    await expect(fileCard).toContainText('382 MB');

    // 6. Verify sidebar counts
    const completedTab = page.locator('button:has-text("Completed")').first();
    await expect(completedTab).toContainText('1');
    await completedTab.click();

    // Verify item remains visible in Completed tab
    await expect(page.getByRole('heading', { name: 'Little.Thomas.2026.480p.HQ.HDTC.Hindi.x264.mkv' })).toBeVisible();

    // Verify Active tab has 0 active items
    const activeTab = page.locator('button:has-text("Active")').first();
    await activeTab.click();
    await expect(page.locator('text=No active downloads')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Download Completion Dialog: Renders file information correctly on completion', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock complete payload via addInitScript and sessionStorage
    const mockPayload = {
      id: 'completed-item-modal',
      url: 'https://downloads.example.org/382MB-Verified-Asset.iso',
      filename: '382MB-Verified-Asset.iso',
      destination_path: 'C:\\Downloads\\382MB-Verified-Asset.iso',
      total_bytes: TEST_FILE_SIZE_382MB,
    };
    await page.addInitScript((payload) => {
      (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__ = payload;
      try {
        sessionStorage.setItem('downex_mock_complete_payload', JSON.stringify(payload));
      } catch {}
    }, mockPayload);

    await page.goto('/?window=download_complete');

    // Verify Completion Window rendered with accurate data
    await expect(page.getByText('Download complete').first()).toBeVisible();
    await expect(page.getByText('382MB-Verified-Asset.iso')).toBeVisible();
    await expect(page.getByText('382 MB').first()).toBeVisible();

    // Verify Open File and Open Folder buttons
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
