import { test, expect } from '@playwright/test';
import * as path from 'path';

test('measure and screenshot queue paused badge alignment in header banner', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const queuesNav = page.locator('button', { hasText: 'Queues' });
  await queuesNav.click();
  await page.waitForTimeout(400);

  const banner = page.locator('div:has(> div > div > h3:has-text("Simple 1-by-1 Queue"))').first();
  await expect(banner).toBeVisible();

  const titleRow = page.locator('div:has(> h3:has-text("Simple 1-by-1 Queue"))').first();

  const measurements = await banner.evaluate((el) => {
    const row = el.querySelector('h3')?.parentElement as HTMLElement;
    const items = Array.from(row.children) as HTMLElement[];
    return items.map((child) => {
      const rect = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      return {
        tag: child.tagName,
        text: child.textContent?.trim(),
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        centerY: Math.round((rect.top + rect.height / 2) * 10) / 10,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
  });

  console.log('NEW MEASUREMENTS:', JSON.stringify(measurements, null, 2));

  // Verify all elements share exact identical centerY within 0.5px
  const centerYs = measurements.map((m) => m.centerY);
  const minCenterY = Math.min(...centerYs);
  const maxCenterY = Math.max(...centerYs);
  expect(maxCenterY - minCenterY).toBeLessThanOrEqual(0.5);

  const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';
  await banner.screenshot({ path: path.join(screenshotDir, 'queue_header_aligned_light.png') });
  await titleRow.screenshot({ path: path.join(screenshotDir, 'queue_title_row_aligned_light.png') });

  // Dark mode
  const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
  if (await darkToggle.isVisible()) {
    await darkToggle.click();
    await page.waitForTimeout(400);
    await banner.screenshot({ path: path.join(screenshotDir, 'queue_header_aligned_dark.png') });
    await titleRow.screenshot({ path: path.join(screenshotDir, 'queue_title_row_aligned_dark.png') });
  }
});
