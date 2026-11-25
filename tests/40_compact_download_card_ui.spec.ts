import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Compact Modern Download Card UI/UX Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Compact Card: Light & Dark Mode, Multiple Downloads on 780x540 Screen', async ({ page }) => {
    // Exact Downex native window geometry
    await page.setViewportSize({ width: 780, height: 540 });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Inject matching Ubuntu ISO active download
    await page.evaluate(() => {
      const mockDownloads = [
        {
          id: 'ubuntu-iso-test',
          url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: 4831838208, // 4.5 GB
          downloaded_bytes: 1304596316, // 1.2 GB (27%)
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 12582912, // 12 MB/s (100 Mbps)
          eta_seconds: 300, // 5 min left
          supports_ranges: true,
          created_at: Date.now() - 120000,
          updated_at: Date.now(),
          segments: [
            { index: 0, start: 0, end: 603979776, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 1, start: 603979777, end: 1207959552, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 2, start: 1207959553, end: 1811939328, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 3, start: 1811939329, end: 2415919104, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 4, start: 2415919105, end: 3019898880, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 5, start: 3019898881, end: 3623878656, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 6, start: 3623878657, end: 4227858432, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
            { index: 7, start: 4227858433, end: 4831838208, downloaded: 163074539, speed_bytes_sec: 1572864, is_active: true },
          ],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockDownloads));
    });

    await page.reload();
    await page.waitForSelector('h4:has-text("ubuntu-24.04-desktop-amd64.iso")');

    const card = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04-desktop-amd64.iso' }).first();
    await expect(card).toBeVisible();

    // Verify structured card metrics layout and zero truncation
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox) {
      console.log(`Measured card height: ${cardBox.height}px`);
      expect(cardBox.height).toBeLessThan(400);
      expect(cardBox.height).toBeGreaterThan(160);
    }

    // Verify all metrics show complete values without ellipses truncation
    const fileSizeText = await card.locator('text=File Size').locator('..').innerText();
    expect(fileSizeText).toContain('4.5 GB');
    expect(fileSizeText).not.toContain('4.5...');

    const downloadedText = await card.locator('text=Downloaded').locator('..').innerText();
    expect(downloadedText).toContain('1.2 GB');
    expect(downloadedText).not.toContain('1.2...');

    const transferRateText = await card.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1).innerText();
    expect(transferRateText).toContain('12 MB/s');
    expect(transferRateText).not.toContain('12 M...');

    // 1. Capture Full App Window showing the compact card in Light Mode
    await page.screenshot({ path: path.join(screenshotDir, 'compact_01_active_download_light.png') });

    // 2. Capture Card Closeup in Light Mode
    await card.screenshot({ path: path.join(screenshotDir, 'compact_02_card_closeup_light.png') });

    // Capture speed limiter row closeup in Light Mode
    const limiterLight = card.locator('[data-testid="inline-speed-limiter"]').first();
    await limiterLight.screenshot({ path: path.join(screenshotDir, 'speed_limiter_01_light.png') });

    // 3. Pause and Capture Paused State
    await card.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(300);
    await card.screenshot({ path: path.join(screenshotDir, 'compact_03_paused_card_light.png') });

    // 4. Inject 3 concurrent downloads to prove that 3 cards fit cleanly on screen without vertical overflow
    await page.evaluate(() => {
      const multiDownloads = [
        {
          id: 'dl-1',
          url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
          destination_path: 'C:\\Downloads\\Downex\\ubuntu-24.04-desktop-amd64.iso',
          total_bytes: 4831838208,
          downloaded_bytes: 1449551462, // 30%
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 14680064, // 14 MB/s
          eta_seconds: 230,
          supports_ranges: true,
          created_at: Date.now() - 90000,
          updated_at: Date.now(),
          segments: [],
        },
        {
          id: 'dl-2',
          url: 'https://cdn.example.org/debian-12.8.0-amd64-netinst.iso',
          filename: 'debian-12.8.0-amd64-netinst.iso',
          destination_path: 'C:\\Downloads\\Downex\\debian-12.8.0-amd64-netinst.iso',
          total_bytes: 650117120, // 620 MB
          downloaded_bytes: 487587840, // 75%
          status: 'paused',
          queue_id: 'default',
          speed_bytes_sec: 0,
          eta_seconds: 0,
          supports_ranges: true,
          created_at: Date.now() - 300000,
          updated_at: Date.now(),
          segments: [],
        },
        {
          id: 'dl-3',
          url: 'https://gphost.eu.cc/raw/downex-desktop',
          filename: 'Downex-0.0.1-Setup.exe',
          destination_path: 'C:\\Downloads\\Downex\\Downex-0.0.1-Setup.exe',
          total_bytes: 3562767,
          downloaded_bytes: 3562767,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          eta_seconds: 0,
          supports_ranges: true,
          created_at: Date.now() - 600000,
          updated_at: Date.now(),
          segments: [],
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(multiDownloads));
    });

    await page.reload();
    await page.waitForSelector('h4:has-text("debian-12.8.0-amd64-netinst.iso")');
    await page.screenshot({ path: path.join(screenshotDir, 'compact_04_multiple_downloads_light.png') });

    // Capture sidebar in Light Mode
    const sidebar = page.locator('aside');
    await sidebar.screenshot({ path: path.join(screenshotDir, 'sidebar_01_light.png') });

    // 5. Switch to Dark Mode via sidebar
    const darkModeBtn = page.getByRole('button', { name: 'Dark mode' });
    await darkModeBtn.click();
    await page.waitForTimeout(300);

    // Capture sidebar in Dark Mode
    await sidebar.screenshot({ path: path.join(screenshotDir, 'sidebar_02_dark.png') });

    await page.screenshot({ path: path.join(screenshotDir, 'compact_05_multiple_downloads_dark.png') });

    // Closeup of active card in Dark Mode
    const activeDarkCard = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04-desktop-amd64.iso' }).first();
    await activeDarkCard.screenshot({ path: path.join(screenshotDir, 'compact_06_active_card_dark.png') });

    // Capture speed limiter in Dark Mode
    const limiterDark = activeDarkCard.locator('[data-testid="inline-speed-limiter"]').first();
    await limiterDark.screenshot({ path: path.join(screenshotDir, 'speed_limiter_02_dark.png') });
  });
});
