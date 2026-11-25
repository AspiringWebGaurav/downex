import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — Speed & Stats Industrial Hardware UI', () => {
  test('Speed & Stats view renders in industrial hardware design with compact cards and zero bubbly bloat', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Click "Speed & Stats" in sidebar
    const telemetryNav = page.locator('button', { hasText: 'Speed & Stats' });
    await telemetryNav.click();
    await page.waitForTimeout(400);

    // 1. Verify Header Bar Elements
    await expect(page.locator('h1', { hasText: 'Live Speed & System Details' })).toBeVisible();
    await expect(page.locator('text=HARDWARE TELEMETRY')).toBeVisible();
    await expect(page.locator('text=ENGINE ACTIVE')).toBeVisible();

    // Verify bubbly rounded-full pill is GONE from header
    const bubblyPill = page.locator('div.rounded-full:has-text("Download Engine Running")');
    await expect(bubblyPill).toHaveCount(0);

    // 2. Verify 4 Core Sensor Tiles
    const speedCard = page.locator('[data-testid="telemetry-card-speed"]');
    const partsCard = page.locator('[data-testid="telemetry-card-parts"]');
    const storageCard = page.locator('[data-testid="telemetry-card-storage"]');
    const lifetimeCard = page.locator('[data-testid="telemetry-card-lifetime"]');

    await expect(speedCard).toBeVisible();
    await expect(partsCard).toBeVisible();
    await expect(storageCard).toBeVisible();
    await expect(lifetimeCard).toBeVisible();

    // Verify card height is compact (< 120px, unlike old bloated 150px+ cards)
    const cardBox = await speedCard.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.height).toBeLessThan(120);

    // 3. Verify Speed History Graph Box
    await expect(page.locator('h2', { hasText: 'SPEED HISTORY (LAST 30 SECONDS)' })).toBeVisible();
    await expect(page.locator('text=REAL-TIME STREAM')).toBeVisible();

    // 4. Verify 3 Bottom Diagnostics Cards
    await expect(page.locator('h3', { hasText: 'DOWNLOAD TASKS' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'DOWNLOAD ENGINE' })).toBeVisible();
    await expect(page.locator('h3', { hasText: 'STORAGE & INTEGRITY' })).toBeVisible();

    // 5. Screenshot in Light Mode
    const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';
    await page.screenshot({ path: path.join(screenshotDir, 'speed_stats_industrial_light.png') });

    // 6. Toggle Dark Mode and capture
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(screenshotDir, 'speed_stats_industrial_dark.png') });
    }
  });
});
