import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Dev QA Studio & Control Center Full Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });
  test('1. Verify Dev QA Pill and Open Control Panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Locate Dev QA button
    const devQaBtn = page.locator('button:has-text("Dev QA")');
    await expect(devQaBtn).toBeVisible({ timeout: 5000 });

    // Click Dev QA button to open the Control Center
    await devQaBtn.click();
    await page.waitForSelector('text=Dev QA & Control Center', { timeout: 5000 });

    // Verify tabs exist
    await expect(page.getByRole('button', { name: 'Downloads', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modals', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'OTA Updates', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Base & Tools', exact: true })).toBeVisible();
  });

  test('2. Downloads Tab: Test All Mock Streams, Speed Meters, Status Cards & Clear All', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Open Dev QA
    await page.locator('button:has-text("Dev QA")').click();
    await page.waitForSelector('text=Dev QA & Control Center');

    // Make sure we are on Downloads tab
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();

    // 1. Add 100 Mbps stream
    await page.locator('button:has-text("100 Mbps (ISO)")').click();
    await page.waitForTimeout(600);

    // 2. Add Fresh 0% stream
    await page.locator('button:has-text("Fresh 0% (3GB)")').click();
    await page.waitForTimeout(600);

    // 3. Add Completed card
    await page.locator('button:has-text("Completed (100%)")').click();
    await page.waitForTimeout(400);

    // 4. Add Paused card
    await page.locator('button:has-text("Paused (50%)")').click();
    await page.waitForTimeout(400);

    // 5. Add Queued card
    await page.locator('button:has-text("Queued")').click();
    await page.waitForTimeout(400);

    // 6. Add Error card
    await page.locator('button:has-text("Error / Failed")').click();
    await page.waitForTimeout(1000);

    // Verify table has populated items
    const rows = page.locator('[data-testid^="delete-btn-"]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(4);

    // Capture screenshot of live downloads tab with active streams and status cards
    const screenshot1 = path.join(screenshotDir, 'qa_01_downloads_tab_active_streams.png');
    await page.screenshot({ path: screenshot1 });
    console.log(`Saved screenshot: ${screenshot1}`);

    // Test Clear All
    await page.locator('button:has-text("Clear All Downloads")').click();
    await page.waitForTimeout(500);

    // Verify all rows cleared
    const rowCountAfter = await rows.count();
    expect(rowCountAfter).toBe(0);

    const screenshotCleared = path.join(screenshotDir, 'qa_02_cleared_table.png');
    await page.screenshot({ path: screenshotCleared });
    console.log(`Saved screenshot: ${screenshotCleared}`);
  });

  test('3. Modals Tab: Test Prefilled Ubuntu ISO and Queue Guide Modals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Open Dev QA
    await page.locator('button:has-text("Dev QA")').click();
    await page.waitForSelector('text=Dev QA & Control Center');

    // Switch to Modals tab
    await page.getByRole('button', { name: 'Modals', exact: true }).click();

    // Open Ubuntu ISO Prefilled modal
    await page.locator('button:has-text("Ubuntu ISO (6GB)")').click();
    await page.waitForSelector('text=New Download', { timeout: 5000 });
    await expect(page.locator('input[placeholder="Filename"]')).toBeVisible({ timeout: 5000 });

    const screenshotModal = path.join(screenshotDir, 'qa_03_prefilled_modal.png');
    await page.screenshot({ path: screenshotModal });
    console.log(`Saved screenshot: ${screenshotModal}`);

    // Close the modal
    await page.locator('button:has-text("Cancel")').first().click();
    await page.waitForTimeout(500);

    // Open Queue Guide (webpage redirect per request)
    await page.evaluate(() => {
      (window as any).__lastOpenedUrls = [];
      window.open = (url: any) => {
        (window as any).__lastOpenedUrls.push(String(url));
        return null;
      };
    });

    await page.locator('button:has-text("Queue Guide")').click();
    await page.waitForTimeout(300);

    const openedUrls = await page.evaluate(() => (window as any).__lastOpenedUrls || []);
    expect(openedUrls).toContain('https://downex.apps.gauravpatil.site/how-queues-work');
  });

  test('4. OTA Updates Tab: Test Stage-by-Stage Progression and UP TO DATE Badge', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Open Dev QA
    await page.locator('button:has-text("Dev QA")').click();
    await page.waitForSelector('text=Dev QA & Control Center');

    // Switch to OTA Updates tab
    await page.getByRole('button', { name: 'OTA Updates', exact: true }).click();

    // Test Stage 1: Available
    await page.locator('button:has-text("1. Available")').click();
    await page.waitForTimeout(500);

    // Test Stage 2: Download
    await page.locator('button:has-text("2. Download")').click();
    await page.waitForTimeout(500);

    // Test Stage 3: Verifying
    await page.locator('button:has-text("3. Verifying")').click();
    await page.waitForTimeout(500);

    // Test Stage 4: Queued
    await page.locator('button:has-text("4. Queued")').click();
    await page.waitForTimeout(500);

    // Test Stage 5: Patching
    await page.locator('button:has-text("5. Patching")').click();
    await page.waitForTimeout(500);

    // Test Stage 6: Ready
    await page.locator('button:has-text("6. Ready")').click();
    await page.waitForTimeout(500);

    // Test Up to Date (3.5s)
    await page.locator('button:has-text("Up to Date (3.5s)")').click();
    await page.waitForTimeout(1000);

    const screenshotOta = path.join(screenshotDir, 'qa_05_ota_stage_progression.png');
    await page.screenshot({ path: screenshotOta });
    console.log(`Saved screenshot: ${screenshotOta}`);

    // Reset to idle
    await page.locator('button:has-text("Reset to Idle")').click();
    await page.waitForTimeout(500);
  });

  test('5. Base & Tools Tab: Theme Toggle & Base App Reset', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Open Dev QA
    await page.locator('button:has-text("Dev QA")').click();
    await page.waitForSelector('text=Dev QA & Control Center');

    // Switch to Base & Tools tab
    await page.getByRole('button', { name: 'Base & Tools', exact: true }).click();

    // Toggle theme via header sun/moon button
    const themeBtn = page.locator('button[title="Toggle Light / Dark mode"]');
    await themeBtn.click();
    await page.waitForTimeout(600);

    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);

    const screenshotTheme = path.join(screenshotDir, 'qa_06_dark_theme_via_qa.png');
    await page.screenshot({ path: screenshotTheme });
    console.log(`Saved screenshot: ${screenshotTheme}`);

    // Reset to Base App
    const resetBtn = page.locator('button:has-text("Reset to Base App")');
    await resetBtn.click();
    await page.waitForTimeout(800);

    // Switch back to light theme
    await themeBtn.click();
    await page.waitForTimeout(400);

    const screenshotFinal = path.join(screenshotDir, 'qa_07_final_light_clean.png');
    await page.screenshot({ path: screenshotFinal });
    console.log(`Saved screenshot: ${screenshotFinal}`);
  });
});
