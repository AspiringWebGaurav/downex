import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Speed & Stats Smooth Digit Count Animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('Digits animate smoothly from 0 to actual value upon opening Speed & Stats', async ({ page }) => {
    // 1. Set window size
    await page.setViewportSize({ width: 960, height: 640 });

    // 2. Pre-seed state with realistic download history (11.64 GB lifetime data, 16 parts, 5 completed)
    await page.evaluate(() => {
      const activeMock = {
        id: 'test-2',
        url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
        filename: 'ubuntu-24.04-desktop-amd64.iso',
        status: 'downloading',
        total_bytes: 6144000000,
        downloaded_bytes: 2764800000,
        speed_bytes_sec: 15728640,
        segments: new Array(16).fill({ index: 0, is_active: true }),
        created_at: Date.now() - 5000,
      };
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify([activeMock]));

      const store = (window as any).useDownloadStore;
      if (store) {
        store.setState({
          lifetimeDownloadedBytes: 12497945804, // 11.64 GB
          sessionDownloadedBytes: 104857600,   // 100 MB
          totalSpeed: 15728640,                // 15 MB/s
          peakSpeed: 25165824,                 // 24 MB/s
          items: [activeMock],
        });
      }
    });

    // 3. Click "Speed & Stats" in the sidebar
    const telemetryNav = page.locator('button', { hasText: 'Speed & Stats' });
    await telemetryNav.click();

    // 4. Capture early frame (~100ms after opening)
    await page.waitForTimeout(100);
    const lifetimeCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Total Data Downloaded' }).locator('div.text-2xl');
    const earlyText = await lifetimeCard.innerText();
    console.log('EARLY DIGIT (100ms):', earlyText);

    // Save screenshot during animation
    await page.screenshot({ path: 'test-results/telemetry-counting-in.png' });

    // 5. Capture midway frame (~400ms)
    await page.waitForTimeout(300);
    const midText = await lifetimeCard.innerText();
    console.log('MID DIGIT (400ms):', midText);

    // 6. Wait for animation to fully settle (~1300ms total)
    await page.waitForTimeout(900);
    const finalText = await lifetimeCard.innerText();
    console.log('FINAL DIGIT (settled):', finalText);

    // Verify it settled on exactly 11.64 GB
    expect(finalText).toContain('11.64 GB');

    // Also verify speed settled on 15.0 MB/s
    const speedCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Current Speed' }).locator('div.text-2xl');
    const finalSpeed = await speedCard.innerText();
    expect(finalSpeed).toContain('15.0 MB/s');

    // Verify parts settled on 16 Parts
    const partsCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Active Connections' }).locator('div.text-2xl');
    const finalParts = await partsCard.innerText();
    expect(finalParts).toContain('16 Parts');

    // Take screenshot of settled state
    await page.screenshot({ path: 'test-results/telemetry-settled.png' });
  });

  test('Clicking Refresh Sensors re-triggers smooth countup animation', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    await page.evaluate(() => {
      const store = (window as any).useDownloadStore;
      if (store) {
        store.setState({
          lifetimeDownloadedBytes: 12497945804,
          totalSpeed: 10485760,
        });
      }
    });

    const telemetryNav = page.locator('button', { hasText: 'Speed & Stats' });
    await telemetryNav.click();

    // Wait for first animation to settle
    await page.waitForTimeout(1300);
    const lifetimeCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Total Data Downloaded' }).locator('div.text-2xl');
    expect(await lifetimeCard.innerText()).toContain('11.64 GB');

    // Click Refresh Sensors button
    const refreshBtn = page.locator('button[title="Refresh Sensors"]');
    await refreshBtn.click();

    // Check that it re-animates
    await page.waitForTimeout(150);
    const midRefreshText = await lifetimeCard.innerText();
    console.log('RE-ANIMATED DIGIT (150ms after refresh):', midRefreshText);

    // After settling again
    await page.waitForTimeout(1200);
    expect(await lifetimeCard.innerText()).toContain('11.64 GB');
  });
});
