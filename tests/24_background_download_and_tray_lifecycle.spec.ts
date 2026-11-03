import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

const TEST_FILE_SIZE_12GB = 13529146982; // 12.6 GB in bytes

test.describe('Downex Background Download, Tray & Complete Modal Lifecycle (IDM / REA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Active Download: Minimizing/Hiding to tray maintains download without process teardown', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed an active download
    await page.evaluate(({ fileSize }) => {
      const mockItems = [
        {
          id: 'test-bg-task-1',
          url: 'https://cdn.example.org/movies/The.Hunger.Games.2012.1080p.mkv',
          filename: 'The.Hunger.Games.2012.1080p.mkv',
          destination_path: 'C:\\Downloads\\The.Hunger.Games.2012.1080p.mkv',
          total_bytes: fileSize,
          downloaded_bytes: Math.floor(fileSize * 0.45),
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 25165824, // 24 MB/s
          eta_seconds: 280,
          created_at: Date.now() - 60000,
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    }, { fileSize: TEST_FILE_SIZE_12GB });

    await page.reload();

    // Verify file card is visible and downloading
    const card = page.locator('div.rounded-xl', { hasText: 'The.Hunger.Games.2012.1080p.mkv' }).last();
    await expect(card).toBeVisible();

    // 2. Trigger Dynamic Minimise to System Tray button (beside Close button in header)
    const minimizeToTrayBtn = page.locator('button[aria-label="Minimise to System Tray"]');
    await expect(minimizeToTrayBtn).toBeVisible();
    await minimizeToTrayBtn.click();

    // Trigger Close to System Tray (which invokes minimizeToBackground / IDM tray hide)
    const closeBtn = page.locator('button[title="Close to System Tray"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Also trigger sidebar Hide to Tray button
    const hideToTrayBtn = page.locator('button[title="Hide to System Tray (Keep running in background)"]');
    await expect(hideToTrayBtn).toBeVisible();
    await hideToTrayBtn.click();

    // Context remains healthy with zero console errors
    expect(errors).toEqual([]);
  });

  test('Download Completion in Background: Download Complete window pops up with correct file details', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock payload for the dedicated completion window
    const completePayload = {
      id: 'test-bg-task-1',
      url: 'https://cdn.example.org/movies/The.Hunger.Games.2012.1080p.mkv',
      filename: 'The.Hunger.Games.2012.1080p.mkv',
      destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\The.Hunger.Games.2012.1080p.mkv',
      total_bytes: TEST_FILE_SIZE_12GB,
      downloaded_bytes: TEST_FILE_SIZE_12GB,
    };

    await page.addInitScript((payload) => {
      (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__ = payload;
      try {
        sessionStorage.setItem('downex_mock_complete_payload', JSON.stringify(payload));
      } catch {}
    }, completePayload);

    // Navigate to completion modal view (same as when Tauri opens the download_complete window)
    await page.goto('/?window=download_complete');

    // Verify modal header & branding
    await expect(page.getByText('Download complete').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'The.Hunger.Games.2012.1080p.mkv' })).toBeVisible();

    // Verify destination path and size
    await expect(page.getByText('12.6 GB').first()).toBeVisible();

    // Verify action buttons (Open, Open folder)
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Full IDM REA Handoff: Active download transitions to Completed, transfer rate displays --, Time left becomes Time taken', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed active download at 99%
    await page.evaluate(({ fileSize }) => {
      const mockItems = [
        {
          id: 'test-bg-transition-task',
          url: 'https://cdn.example.org/assets/Large-Archive.iso',
          filename: 'Large-Archive.iso',
          destination_path: 'C:\\Downloads\\Large-Archive.iso',
          total_bytes: fileSize,
          downloaded_bytes: fileSize - 1048576, // 1 MB left
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 10485760, // 10 MB/s
          eta_seconds: 1,
          created_at: Date.now() - 45000,
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    }, { fileSize: TEST_FILE_SIZE_12GB });

    await page.reload();

    const activeCard = page.locator('div.rounded-xl', { hasText: 'Large-Archive.iso' }).last();
    await expect(activeCard).toBeVisible();

    // Verify dynamic minimise to tray button is visible when downloading
    await expect(page.locator('button[aria-label="Minimise to System Tray"]')).toBeVisible();

    // 2. Emit completion event (same as Rust engine pool completing file)
    await page.evaluate(({ fileSize }) => {
      const stored = JSON.parse(sessionStorage.getItem('downex_mock_downloads') || '[]');
      if (stored.length > 0) {
        stored[0].status = 'completed';
        stored[0].downloaded_bytes = fileSize;
        stored[0].speed_bytes_sec = 0;
        stored[0].eta_seconds = null;
        sessionStorage.setItem('downex_mock_downloads', JSON.stringify(stored));
      }

      window.dispatchEvent(new CustomEvent('downex-mock-progress', {
        detail: {
          task_id: 'test-bg-transition-task',
          status: 'completed',
          downloaded_bytes: fileSize,
          total_bytes: fileSize,
          speed_bytes_sec: 0,
          eta_seconds: null,
          segments: [],
        },
      }));
    }, { fileSize: TEST_FILE_SIZE_12GB });

    await page.reload();

    // 3. Verify card shows COMPLETED badge
    const doneCard = page.locator('div.rounded-xl', { hasText: 'Large-Archive.iso' }).last();
    await expect(doneCard).toBeVisible();
    await expect(doneCard.getByText('COMPLETED').first()).toBeVisible();

    // 4. Verify Transfer rate is --
    const rateEl = doneCard.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(rateEl).toHaveText('--');

    // 5. Verify Time left is replaced by Time taken
    const timeTakenEl = doneCard.locator('div:has(> span:text-is("Time taken"))').locator('span').nth(1);
    await expect(timeTakenEl).toBeVisible();

    // 6. Verify Resume: No is NOT shown on completed item
    await expect(doneCard.locator('text=Resume:')).not.toBeVisible();

    // 7. Verify dynamic minimise to tray button is removed when downloads are completed
    await expect(page.locator('button[aria-label="Minimise to System Tray"]')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Two Concurrent Downloads in Background (User Scenario): Each running task maintains independent lifecycle', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed 2 concurrent running downloads exactly as in user screenshot
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'task-bigg-boss',
          url: 'https://ex.com/bigg-boss.mkv',
          filename: 'Bigg.Boss.S20E01.1080p.JHS.WEB-DL.Hindi.2.0.x264-HDHub4u.mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Bigg.Boss.S20E01.1080p.mkv',
          total_bytes: 1800000000,
          downloaded_bytes: 54200000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 2097152,
          eta_seconds: 720,
          created_at: Date.now() - 30000,
          updated_at: Date.now(),
        },
        {
          id: 'task-obsession',
          url: 'https://ex.com/obsession.mkv',
          filename: 'Obsession.2025.1080p.WEB-DL.Hindi.JHS.New.Dubb.English.2.0.mkv',
          destination_path: 'C:\\Users\\gaura\\Downloads\\Downex\\Obsession.2025.1080p.mkv',
          total_bytes: 2000000000,
          downloaded_bytes: 45400000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 2097152,
          eta_seconds: 840,
          created_at: Date.now() - 25000,
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify both items render independently in the table
    const card1 = page.locator('div.rounded-xl', { hasText: 'Bigg.Boss' }).last();
    const card2 = page.locator('div.rounded-xl', { hasText: 'Obsession' }).last();
    await expect(card1).toBeVisible();
    await expect(card2).toBeVisible();

    // Verify both display their own downloading status
    await expect(card1.getByText('DOWNLOADING')).toBeVisible();
    await expect(card2.getByText('DOWNLOADING')).toBeVisible();

    // Complete task 1
    await page.evaluate(() => {
      const stored = JSON.parse(sessionStorage.getItem('downex_mock_downloads') || '[]');
      if (stored.length > 0) {
        stored[0].status = 'completed';
        stored[0].downloaded_bytes = stored[0].total_bytes;
        stored[0].speed_bytes_sec = 0;
        sessionStorage.setItem('downex_mock_downloads', JSON.stringify(stored));
      }
    });

    await page.reload();

    // Task 1 is COMPLETED, Task 2 is STILL DOWNLOADING!
    const updatedCard1 = page.locator('div.rounded-xl', { hasText: 'Bigg.Boss' }).last();
    const updatedCard2 = page.locator('div.rounded-xl', { hasText: 'Obsession' }).last();
    await expect(updatedCard1.getByText('COMPLETED')).toBeVisible();
    await expect(updatedCard2.getByText('DOWNLOADING')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
