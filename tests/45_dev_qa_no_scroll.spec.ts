import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Dev QA No Vertical Scroll Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Verify all 4 tabs have zero vertical scroll and fit cleanly', async ({ page }) => {
    // Standard window size
    await page.setViewportSize({ width: 1100, height: 680 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Open Dev QA
    const devQaBtn = page.locator('button:has-text("Dev QA")');
    await expect(devQaBtn).toBeVisible({ timeout: 5000 });
    await devQaBtn.click();
    await page.waitForSelector('text=Dev QA & Control Center', { timeout: 5000 });

    const panel = page.locator('div:has-text("Dev QA & Control Center")').locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]').first();
    await expect(panel).toBeVisible();

    const tabs = [
      { name: 'Downloads', filename: 'dev_qa_01_tab_downloads_light.png' },
      { name: 'Modals', filename: 'dev_qa_02_tab_modals_light.png' },
      { name: 'OTA Updates', filename: 'dev_qa_03_tab_ota_light.png' },
      { name: 'Base & Tools', filename: 'dev_qa_04_tab_base_light.png' },
    ];

    for (const t of tabs) {
      await page.getByRole('button', { name: t.name, exact: true }).click();
      await page.waitForTimeout(300);

      // Check overflow and scroll metrics
      const metrics = await panel.evaluate((el) => {
        return {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          hasVerticalScroll: el.scrollHeight > el.clientHeight,
          computedOverflowY: window.getComputedStyle(el).overflowY,
        };
      });

      console.log(`Tab: ${t.name} -> metrics:`, metrics);
      expect(metrics.hasVerticalScroll).toBe(false);

      // Take screenshot of Dev QA panel
      await panel.screenshot({ path: path.join(screenshotDir, t.filename) });
      console.log(`Saved screenshot: ${t.filename}`);
    }

    // Also toggle Dark mode and capture Tab 1 in Dark mode
    const darkToggle = page.locator('button[title="Toggle Light / Dark mode"]');
    await darkToggle.click();
    await page.waitForTimeout(300);

    // Switch to Downloads tab in dark mode
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.waitForTimeout(200);

    const darkMetrics = await panel.evaluate((el) => {
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        hasVerticalScroll: el.scrollHeight > el.clientHeight,
      };
    });
    console.log('Dark mode Tab: Downloads -> metrics:', darkMetrics);
    expect(darkMetrics.hasVerticalScroll).toBe(false);

    await panel.screenshot({ path: path.join(screenshotDir, 'dev_qa_05_tab_downloads_dark.png') });
    console.log('Saved screenshot: dev_qa_05_tab_downloads_dark.png');

    // Also capture full window screenshot with Dev QA open
    await page.screenshot({ path: path.join(screenshotDir, 'dev_qa_06_full_window_dark.png') });
    console.log('Saved screenshot: dev_qa_06_full_window_dark.png');
  });
});
