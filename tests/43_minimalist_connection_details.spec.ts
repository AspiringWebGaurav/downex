import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Minimalist Connections & Segments Details View', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Connections & Segments details renders sleek, minimalistic industrial UI in Light and Dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 620 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const totalBytes = 4831838208; // 4.5 GB
    const segBytes = 603979776; // ~572 MB per segment
    const downloadedPerSeg = 164528128; // ~156.9 MB

    // Seed matching Ubuntu ISO with 8 active connections
    await page.evaluate(({ total, segLen, segDownloaded }) => {
      const segments = Array.from({ length: 8 }, (_, i) => ({
        index: i,
        start: i * segLen,
        end: (i + 1) * segLen - 1,
        downloaded: segDownloaded,
        speed_bytes_sec: 1572864,
        is_active: true,
      }));

      const mockDownloads = [
        {
          id: 'ubuntu-iso-test',
          url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: total,
          downloaded_bytes: segDownloaded * 8, // ~1.25 GB (27%)
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12582912, // 12 MB/s
          eta_seconds: 300,
          supports_ranges: true,
          created_at: Date.now() - 120000,
          updated_at: Date.now(),
          segments,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockDownloads));
    }, { total: totalBytes, segLen: segBytes, segDownloaded: downloadedPerSeg });

    await page.reload();
    await page.waitForSelector('h4:has-text("ubuntu-24.04-desktop-amd64.iso")');

    const card = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04-desktop-amd64.iso' }).first();
    await expect(card).toBeVisible();

    // 1. Expand details
    const detailsBtn = card.getByRole('button', { name: /Show details/i }).first();
    await detailsBtn.click();
    await page.waitForTimeout(300);

    // 2. Verify header elements
    await expect(card.getByText('Start positions and download progress by connections')).toBeVisible();
    await expect(card.getByText('8 Active')).toBeVisible();
    await expect(card.getByText('8 THREADS')).toBeVisible();

    // 3. Verify visualizer bar renders 8 segments
    const visualizer = card.locator('div.overflow-hidden.flex.gap-\\[2px\\]').first();
    await expect(visualizer).toBeVisible();

    // 4. Verify table headers and first 4 rows
    await expect(card.getByText('Range Span')).toBeVisible();
    await expect(card.getByText('Connection Info')).toBeVisible();
    await expect(card.getByText('Receiving data...').first()).toBeVisible();

    // Capture Light Mode (4 connections collapsed)
    await card.screenshot({ path: path.join(screenshotDir, 'details_01_light_collapsed.png') });

    // 5. Expand to all 8 connections
    const showMoreBtn = card.getByRole('button', { name: /Show all 8 connections/i });
    await expect(showMoreBtn).toBeVisible();
    await showMoreBtn.click();
    await page.waitForTimeout(200);

    // Capture Light Mode (all 8 connections expanded)
    await card.screenshot({ path: path.join(screenshotDir, 'details_02_light_all_8.png') });

    // 6. Switch to Dark Mode
    const darkModeBtn = page.getByRole('button', { name: 'Dark mode' });
    await darkModeBtn.click();
    await page.waitForTimeout(300);

    // Capture Dark Mode (all 8 connections expanded)
    await card.screenshot({ path: path.join(screenshotDir, 'details_03_dark_all_8.png') });

    // 7. Collapse back to 4 connections
    const collapseBtn = card.getByRole('button', { name: /Show first 4 connections/i });
    await collapseBtn.click();
    await page.waitForTimeout(200);

    // Capture Dark Mode (4 connections collapsed)
    await card.screenshot({ path: path.join(screenshotDir, 'details_04_dark_collapsed.png') });
  });
});
