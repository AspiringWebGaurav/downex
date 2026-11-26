import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Inline Speed Limiter & Dynamic MB Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Inline Speed Limiter renders directly below progress bar with 2px gap', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    // Seed mock active download (~100 Mbps)
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'limiter-test-dl-1',
          url: 'https://cdn.example.org/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: 4294967296,
          downloaded_bytes: 1073741824,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12500000, // ~100 Mbps
          eta_seconds: 257,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify download item is rendered
    await expect(page.getByRole('heading', { name: 'ubuntu-24.04-desktop-amd64.iso' })).toBeVisible();

    // Verify inline speed limiter exists
    const limiter = page.locator('[data-testid="inline-speed-limiter"]').first();
    await expect(limiter).toBeVisible();

    const progressBar = page.locator('.w-full.h-\\[15px\\]').first();
    await expect(progressBar).toBeVisible();
    const progressBox = await progressBar.boundingBox();

    // Verify single-line compact height (between 20px and 32px)
    const limiterBox = await limiter.boundingBox();
    expect(limiterBox).not.toBeNull();
    expect(progressBox).not.toBeNull();

    if (progressBox && limiterBox) {
      // Gap between progress bar bottom and limiter top is exactly 2px (clamped within [1, 4])
      const gapFromProgressBar = limiterBox.y - (progressBox.y + progressBox.height);
      expect(gapFromProgressBar).toBeGreaterThanOrEqual(1);
      expect(gapFromProgressBar).toBeLessThanOrEqual(4);

      expect(limiterBox.height).toBeGreaterThanOrEqual(20);
      expect(limiterBox.height).toBeLessThanOrEqual(32);
    }

    // Verify details toggle button is below the limiter
    const detailsBtn = page.getByRole('button', { name: /Show details/i }).first();
    await expect(detailsBtn).toBeVisible();
    const detailsBox = await detailsBtn.boundingBox();
    expect(detailsBox).not.toBeNull();

    if (limiterBox && detailsBox) {
      expect(limiterBox.y).toBeLessThan(detailsBox.y);
    }
  });

  test('Starter options (50M, 100M, 150M, 180M, 200M) apply with dynamic MB conversion', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'starter-options-dl',
          url: 'https://cdn.example.org/dataset.zip',
          filename: 'dataset.zip',
          destination_path: 'C:\\Downloads\\dataset.zip',
          total_bytes: 1073741824,
          downloaded_bytes: 268435456,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12000000,
          eta_seconds: 67,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const limiter = page.locator('[data-testid="inline-speed-limiter"]').first();
    await expect(limiter).toBeVisible();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();
    const btn50 = page.locator('[data-testid="speed-limiter-preset-50"]').first();
    const btn100 = page.locator('[data-testid="speed-limiter-preset-100"]').first();
    const btn150 = page.locator('[data-testid="speed-limiter-preset-150"]').first();
    const btn180 = page.locator('[data-testid="speed-limiter-preset-180"]').first();
    const btn190 = page.locator('[data-testid="speed-limiter-preset-190"]').first();
    const btn200 = page.locator('[data-testid="speed-limiter-preset-200"]').first();
    const resetBtn = page.locator('[data-testid="speed-limiter-reset"]').first();

    // Verify all 6 starter options are present with clear Mb units
    await expect(btn50).toHaveText('50Mb');
    await expect(btn100).toHaveText('100Mb');
    await expect(btn150).toHaveText('150Mb');
    await expect(btn180).toHaveText('180Mb');
    await expect(btn190).toHaveText('190Mb');
    await expect(btn200).toHaveText('200Mb');

    // Initial state: Unthrottled, reset button disabled
    await expect(resetBtn).toBeDisabled();
    await expect(input).toHaveValue('');

    // Click 50M: 50 Mbps = 6.25 MB/s
    await btn50.click();
    await expect(input).toHaveValue('50');
    const status = page.locator('[data-testid="speed-limiter-status"]').first();
    await expect(status).toHaveText(/50 Mbps Cap \(=6\.25 MB\/s\)/);
    await expect(resetBtn).toBeEnabled();

    // Click 180M starter option: 180 Mbps = 22.5 MB/s
    await btn180.click();
    await expect(input).toHaveValue('180');
    await expect(status).toHaveText(/180 Mbps Cap \(=22\.5 MB\/s\)/);

    // Click 200M: 200 Mbps = 25 MB/s
    await btn200.click();
    await expect(input).toHaveValue('200');
    await expect(status).toHaveText(/200 Mbps Cap \(=25 MB\/s\)/);

    // Verify zero dialogs
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('Custom digit input (e.g. 120) displays live dynamic MB, has explicit Save button, and saves to database locally', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'custom-input-dl',
          url: 'https://cdn.example.org/video.mp4',
          filename: 'video.mp4',
          destination_path: 'C:\\Downloads\\video.mp4',
          total_bytes: 524288000,
          downloaded_bytes: 104857600,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 8000000,
          eta_seconds: 52,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const customContainer = page.locator('[data-testid="speed-limiter-custom-container"]').first();
    await expect(customContainer).toBeVisible();
    await expect(customContainer).toContainText('Mb');

    // Verify smooth hover styling is active without transition-all layout reflows
    await customContainer.hover();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();

    // Type 120 in the custom box
    await input.click();
    await input.fill('120');

    // Verify live dynamic MB displays right inside the custom box: 120 Mbps = 15 MB/s
    const dynamicMb = page.locator('[data-testid="speed-limiter-dynamic-mb"]').first();
    await expect(dynamicMb).toBeVisible();
    await expect(dynamicMb).toHaveText('=15 MB/s');

    // Explicit Save button appears when custom value is typed
    const saveBtn = page.locator('[data-testid="speed-limiter-save-btn"]').first();
    await expect(saveBtn).toBeVisible();

    // Click Save to commit to local database
    await saveBtn.click();

    await expect(input).toHaveValue('120');
    const status = page.locator('[data-testid="speed-limiter-status"]').first();
    await expect(status).toHaveText(/120 Mbps Cap \(=15 MB\/s\)/);

    // Verify SAVED confirmation indicator is briefly displayed
    const savedIndicator = page.locator('[data-testid="speed-limiter-saved-indicator"]').first();
    await expect(savedIndicator).toBeVisible();

    // Verify persisted in localStorage / database locally
    const savedInStorage = await page.evaluate(() => {
      return localStorage.getItem('downex_saved_custom_speed_limit');
    });
    expect(savedInStorage).toBe('120');

    // Verify NO extra custom button was created in the row
    await expect(page.locator('[data-testid="speed-limiter-dynamic-preset"]')).toHaveCount(0);
  });

  test('Reset fully detaches speed limit and restores normal full speed', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'clear-test-dl',
          url: 'https://cdn.example.org/archive.7z',
          filename: 'archive.7z',
          destination_path: 'C:\\Downloads\\archive.7z',
          total_bytes: 800000000,
          downloaded_bytes: 200000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 10000000,
          speed_limit_mbps: 100,
          eta_seconds: 60,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();
    const status = page.locator('[data-testid="speed-limiter-status"]').first();
    const resetBtn = page.locator('[data-testid="speed-limiter-reset"]').first();

    // Verify initial capped state: 100 Mbps Cap (=12.5 MB/s)
    await expect(input).toHaveValue('100');
    await expect(status).toHaveText(/100 Mbps Cap \(=12\.5 MB\/s\)/);
    await expect(resetBtn).toBeEnabled();

    // Click Reset button
    await resetBtn.click();

    // Verify fully detached: cap badge is removed, input cleared, reset button disabled
    await expect(input).toHaveValue('');
    await expect(page.locator('[data-testid="speed-limiter-status"]')).toHaveCount(0);
    await expect(resetBtn).toBeDisabled();
  });

  test('Limiter maintains state across Pause and Resume lifecycles', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'lifecycle-dl-1',
          url: 'https://cdn.example.org/kernel.img',
          filename: 'kernel.img',
          destination_path: 'C:\\Downloads\\kernel.img',
          total_bytes: 300000000,
          downloaded_bytes: 100000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12500000,
          eta_seconds: 16,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Set 150M starter option
    const btn150 = page.locator('[data-testid="speed-limiter-preset-150"]').first();
    await btn150.click();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();
    const status = page.locator('[data-testid="speed-limiter-status"]').first();
    await expect(status).toHaveText(/150 Mbps Cap \(=18\.(75|8) MB\/s\)/);

    // Pause the download
    const pauseBtn = page.getByRole('button', { name: 'Pause', exact: true }).first();
    await pauseBtn.click();

    // In paused state, limiter remains visible and maintains cap
    await expect(page.locator('[data-testid="inline-speed-limiter"]').first()).toBeVisible();
    await expect(input).toHaveValue('150');
    await expect(status).toHaveText(/150 Mbps Cap \(=18\.(75|8) MB\/s\)/);

    // Resume the download
    const resumeBtn = page.getByRole('button', { name: 'Resume', exact: true }).first();
    await resumeBtn.click();

    // State stays intact
    await expect(input).toHaveValue('150');
    await expect(status).toHaveText(/150 Mbps Cap \(=18\.(75|8) MB\/s\)/);
  });

  test('Saving custom speed with Enter at compact 780x540 desktop viewport never clips input or cap badge', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'compact-viewport-dl',
          url: 'https://cdn.example.org/bundle.iso',
          filename: 'bundle.iso',
          destination_path: 'C:\\Downloads\\bundle.iso',
          total_bytes: 500000000,
          downloaded_bytes: 120000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12500000,
          eta_seconds: 30,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();
    const customContainer = page.locator('[data-testid="speed-limiter-custom-container"]').first();
    const limiter = page.locator('[data-testid="inline-speed-limiter"]').first();

    await input.click();
    await input.fill('192');
    await input.press('Enter');

    const status = page.locator('[data-testid="speed-limiter-status"]').first();
    const savedIndicator = page.locator('[data-testid="speed-limiter-saved-indicator"]').first();
    await expect(status).toHaveText(/192 Mbps Cap \(=24 MB\/s\)/);
    await expect(savedIndicator).toBeVisible();

    const boxes = await Promise.all([
      limiter.boundingBox(),
      customContainer.boundingBox(),
      status.boundingBox(),
    ]);
    const [limiterBox, customBox, statusBox] = boxes;
    expect(limiterBox).not.toBeNull();
    expect(customBox).not.toBeNull();
    expect(statusBox).not.toBeNull();

    // Custom box must be completely clear of right cap badge and contained cleanly inside limiter row
    expect(customBox!.x + customBox!.width).toBeLessThanOrEqual(statusBox!.x);
    expect(statusBox!.x + statusBox!.width).toBeLessThan(limiterBox!.x + limiterBox!.width);
  });

  test('After saving custom speed and Reset, clicking input shows Tab chip and Tab key or click fills saved value for reuse', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'tab-fill-dl',
          url: 'https://cdn.example.org/ubuntu.iso',
          filename: 'ubuntu.iso',
          destination_path: 'C:\\Downloads\\ubuntu.iso',
          total_bytes: 500000000,
          downloaded_bytes: 100000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12500000,
          eta_seconds: 32,
          created_at: Date.now(),
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const input = page.locator('[data-testid="speed-limiter-input"]').first();
    const resetBtn = page.locator('[data-testid="speed-limiter-reset"]').first();
    const tabBtn = page.locator('[data-testid="speed-limiter-tab-fill"]').first();
    const status = page.locator('[data-testid="speed-limiter-status"]').first();

    // 1. Save 192 custom cap then click Reset
    await input.click();
    await input.fill('192');
    await input.press('Enter');
    await expect(status).toHaveText(/192 Mbps Cap \(=24 MB\/s\)/);

    await resetBtn.click();
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', '192');

    // 2. Click input -> Tab button appears -> press Tab key -> fills 192 -> Enter reapplies
    await input.click();
    await expect(tabBtn).toBeVisible();
    await input.press('Tab');
    await expect(input).toHaveValue('192');
    await expect(tabBtn).toHaveCount(0);

    await input.press('Enter');
    await expect(status).toHaveText(/192 Mbps Cap \(=24 MB\/s\)/);

    // 3. Reset again, click input, and click the Tab button directly -> fills 192
    await resetBtn.click();
    await expect(input).toHaveValue('');
    await input.click();
    await expect(tabBtn).toBeVisible();
    await tabBtn.click();
    await expect(input).toHaveValue('192');
    await input.press('Enter');
    await expect(status).toHaveText(/192 Mbps Cap \(=24 MB\/s\)/);
  });
});
