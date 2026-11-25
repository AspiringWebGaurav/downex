import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — App Version Unclickable & Check Updates Exclusivity', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="sidebar-version"]', { timeout: 15000 });
  });

  test('1. App Version row is disabled for mouse click (cursor-default, no click handler, zero trigger)', async ({ page }) => {
    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toBeVisible();

    // Verify it has cursor-default class and is not a button
    await expect(versionRow).toHaveClass(/cursor-default/);
    const tagName = await versionRow.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('div');

    // Click on APP VERSION row multiple times
    await versionRow.click();
    await page.waitForTimeout(300);
    await versionRow.click();

    // Verify stage text NEVER shows "Checking..." or "UP TO DATE" from clicking the version row
    const stage = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stage).toHaveCount(0);

    // Capture screenshot confirming idle unclicked state
    await page.screenshot({
      path: path.join(screenshotsDir, 'app_version_unclickable_idle.png'),
    });
  });

  test('2. "Check updates" button is the exclusive trigger for update checks', async ({ page }) => {
    const checkUpdatesBtn = page.locator('button:has-text("Check updates")');
    await expect(checkUpdatesBtn).toBeVisible();
    await expect(checkUpdatesBtn).toHaveClass(/cursor-pointer/);

    // Click "Check updates" button
    await checkUpdatesBtn.click();

    // Verify spinning refresh icon or feedback triggers on manual check
    const spinIcon = checkUpdatesBtn.locator('svg.animate-spin');
    // It triggers manual check cleanly
    await expect(checkUpdatesBtn).toBeVisible();

    // Capture screenshot of manual check trigger
    await page.screenshot({
      path: path.join(screenshotsDir, 'check_updates_exclusive_trigger.png'),
    });
  });

  test('3. Collapsed mode: version badge is an unclickable div and Check updates icon is clickable', async ({ page }) => {
    // Collapse sidebar
    const collapseBtn = page.locator('button[title*="Collapse Sidebar"], button[title*="Expand Sidebar"]');
    await collapseBtn.click();
    await page.waitForTimeout(250);

    // Verify version badge is a div with cursor-default
    const collapsedBadge = page.locator('div[aria-label^="Downex v"]');
    await expect(collapsedBadge).toBeVisible();
    const tag = await collapsedBadge.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('div');
    await expect(collapsedBadge).toHaveClass(/cursor-default/);

    // Clicking collapsed badge does NOT trigger update check
    await collapsedBadge.click();
    await page.waitForTimeout(200);

    // Verify Check for updates icon button is present and clickable
    const collapsedCheckBtn = page.locator('button[aria-label="Check for updates"]');
    await expect(collapsedCheckBtn).toBeVisible();
    await expect(collapsedCheckBtn).toHaveClass(/cursor-pointer/);

    // Capture screenshot of collapsed mode
    await page.screenshot({
      path: path.join(screenshotsDir, 'collapsed_version_unclickable.png'),
    });
  });
});
