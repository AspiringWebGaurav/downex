import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Dev QA Dot Mode & Speed Test Centered Button Verification', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start with clean state
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('downex_dev_qa_dot_mode');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('Speed Test action button is horizontally centered and symmetric', async ({ page }) => {
    // Navigate to Speed Test tab
    const speedTestNav = page.locator('button:has-text("Speed Test")').first();
    await expect(speedTestNav).toBeVisible({ timeout: 5000 });
    await speedTestNav.click();

    // Verify Speed Test View is rendered
    const viewHeader = page.locator('text=Live Speed Test');
    await expect(viewHeader).toBeVisible({ timeout: 5000 });

    // Locate the control bar and the Start Speed Test button
    const startBtn = page.locator('button:has-text("Start Speed Test")');
    await expect(startBtn).toBeVisible({ timeout: 5000 });

    // The control bar containing the button
    const controlBar = startBtn.locator('xpath=ancestor::div[contains(@class, "border-t")]').first();
    await expect(controlBar).toBeVisible();

    const barBox = await controlBar.boundingBox();
    const btnBox = await startBtn.boundingBox();

    expect(barBox).not.toBeNull();
    expect(btnBox).not.toBeNull();

    if (barBox && btnBox) {
      const barCenter = barBox.x + barBox.width / 2;
      const btnCenter = btnBox.x + btnBox.width / 2;
      const diff = Math.abs(barCenter - btnCenter);
      // Button must be aligned dead center on the vertical axis (diff <= 6px)
      expect(diff).toBeLessThanOrEqual(6);
    }

    // Take Light Mode screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'speedtest_centered_light.png'),
    });

    // Toggle Dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(300);

    // Take Dark Mode screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'speedtest_centered_dark.png'),
    });
  });

  test('Dev QA collapses to a tiny sleek dot and restores cleanly', async ({ page }) => {
    // Verify initial state has Dev QA pill
    const devQaPill = page.locator('[data-testid="dev-qa-pill-trigger"]');
    await expect(devQaPill).toBeVisible({ timeout: 5000 });

    const hideAsDotBtn = page.locator('[data-testid="dev-qa-hide-as-dot"]');
    await expect(hideAsDotBtn).toBeVisible();

    // Click the dot hide button
    await hideAsDotBtn.click();

    // Now Dev QA pill should be replaced by a circular dot
    const devQaDot = page.locator('[data-testid="dev-qa-dot"]');
    await expect(devQaDot).toBeVisible({ timeout: 3000 });
    await expect(devQaPill).not.toBeVisible();

    // Check dimensions of dot (should be small and compact, ~20px)
    const dotBox = await devQaDot.boundingBox();
    expect(dotBox).not.toBeNull();
    if (dotBox) {
      expect(dotBox.width).toBeLessThanOrEqual(28);
      expect(dotBox.height).toBeLessThanOrEqual(28);
    }

    // Screenshot collapsed dot in Light mode
    await page.screenshot({
      path: path.join(screenshotsDir, 'dev_qa_dot_light.png'),
    });

    // Screenshot collapsed dot in Dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, 'dev_qa_dot_dark.png'),
    });

    // Clicking the dot opens the panel
    await devQaDot.click();
    const panelHeader = page.locator('text=Dev QA & Control Center');
    await expect(panelHeader).toBeVisible({ timeout: 3000 });

    // Mode toggle in panel header
    const modeToggle = page.locator('[data-testid="dev-qa-toggle-dot-mode"]');
    await expect(modeToggle).toBeVisible();
    await expect(modeToggle).toContainText('DOT');

    // Toggle back to PILL mode from header
    await modeToggle.click();
    await expect(modeToggle).toContainText('PILL');

    // Close panel
    const closeBtn = page.locator('button[title="Close panel (Ctrl+Shift+D)"]');
    await closeBtn.click();
    await expect(panelHeader).not.toBeVisible();

    // Should now be back to Pill launcher
    await expect(devQaPill).toBeVisible();

    // Test localStorage persistence across reload
    await hideAsDotBtn.click();
    await expect(devQaDot).toBeVisible();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="dev-qa-dot"]')).toBeVisible();

    // Right-click dot to restore pill
    await page.locator('[data-testid="dev-qa-dot"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="dev-qa-pill-trigger"]')).toBeVisible();
  });
});
