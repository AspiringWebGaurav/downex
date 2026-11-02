import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Live Tab Click Fluctuation & Count-Up', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('All 4 cards fluctuate from 0 to dynamic amount when clicking Speed & Stats tab and cards', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // 1. Seed store with 11.64 GB lifetime data and an active download (24.5 MB/s, 8 parts)
    await page.evaluate(() => {
      const activeMock = {
        id: 'test-fluctuate',
        url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
        filename: 'ubuntu-24.04-desktop-amd64.iso',
        status: 'downloading',
        total_bytes: 6144000000,
        downloaded_bytes: 2764800000,
        speed_bytes_sec: 25690112, // 24.5 MB/s
        segments: new Array(8).fill({ index: 0, is_active: true }),
        created_at: Date.now() - 5000,
      };
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify([activeMock]));

      const store = (window as any).useDownloadStore;
      if (store) {
        store.setState({
          lifetimeDownloadedBytes: 12497945804, // 11.64 GB
          sessionDownloadedBytes: 104857600,   // 100 MB
          totalSpeed: 25690112,                // 24.5 MB/s
          peakSpeed: 31457280,                 // 30.0 MB/s
          items: [activeMock],
        });
      }
    });

    // 2. Click "Speed & Stats" tab in sidebar
    const telemetryNav = page.locator('button', { hasText: 'Speed & Stats' });
    await telemetryNav.click();

    // 3. Capture early frame (~100ms)
    await page.waitForTimeout(100);

    const speedCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Current Speed' }).locator('div.text-2xl');
    const partsCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Active Connections' }).locator('div.text-2xl');
    const lifetimeCard = page.locator('div.p-4.rounded-2xl', { hasText: 'Total Data Downloaded' }).locator('div.text-2xl');

    const earlySpeed = await speedCard.innerText();
    const earlyParts = await partsCard.innerText();
    const earlyLifetime = await lifetimeCard.innerText();

    console.log('EARLY (100ms) - Speed:', earlySpeed, '| Parts:', earlyParts, '| Total Data:', earlyLifetime);

    // Save screenshot during early fluctuation
    await page.screenshot({ path: 'test-results/tab-click-fluctuating.png' });

    // Early text should be actively counting (e.g. less than final 11.64 GB)
    const earlyNum = parseFloat(earlyLifetime);
    expect(earlyNum).toBeLessThan(11.64);

    // 4. Wait for full settling (~1300ms)
    await page.waitForTimeout(1200);

    const finalSpeed = await speedCard.innerText();
    const finalParts = await partsCard.innerText();
    const finalLifetime = await lifetimeCard.innerText();

    console.log('FINAL (settled) - Speed:', finalSpeed, '| Parts:', finalParts, '| Total Data:', finalLifetime);

    expect(finalLifetime).toContain('11.64 GB');
    expect(finalSpeed).toContain('24.5 MB/s');
    expect(finalParts).toContain('8 Parts');

    // Save screenshot of settled state
    await page.screenshot({ path: 'test-results/tab-click-settled.png' });

    // 5. Test clicking "Speed & Stats" tab AGAIN while on the page
    console.log('Clicking Speed & Stats tab again to verify re-fluctuation...');
    await telemetryNav.click();

    await page.waitForTimeout(100);
    const retriggerLifetime = await lifetimeCard.innerText();
    console.log('RE-TRIGGER EARLY (100ms):', retriggerLifetime);

    const retriggerNum = parseFloat(retriggerLifetime);
    expect(retriggerNum).toBeLessThan(11.64);

    // Settle again
    await page.waitForTimeout(1200);
    expect(await lifetimeCard.innerText()).toContain('11.64 GB');

    // 6. Test clicking directly on Card 4 (Total Data Downloaded card)
    console.log('Clicking directly on Card 4 to verify card click re-fluctuation...');
    const card4Container = page.locator('div.p-4.rounded-2xl', { hasText: 'Total Data Downloaded' });
    await card4Container.click();

    await page.waitForTimeout(100);
    const cardClickLifetime = await lifetimeCard.innerText();
    console.log('CARD CLICK EARLY (100ms):', cardClickLifetime);
    const cardClickNum = parseFloat(cardClickLifetime);
    expect(cardClickNum).toBeLessThan(11.64);

    await page.waitForTimeout(1200);
    expect(await lifetimeCard.innerText()).toContain('11.64 GB');
  });
});
