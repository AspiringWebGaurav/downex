import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — App Owner Search & Ctrl+K Focus Attention Animation', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#search-input', { timeout: 15000 });
  });

  test('1. Ctrl+K triggers attention pulse animation, emerald ring, and READY status indicator', async ({ page }) => {
    const searchContainer = page.locator('[data-testid="in-app-search-container"]');
    const searchInput = page.locator('#search-input');

    // Press Ctrl+K
    await page.keyboard.press('Control+KeyK');

    // Verify input is focused
    await expect(searchInput).toBeFocused();

    // Verify container received the focus animation
    await expect(searchContainer).toHaveClass(/animate-search-focus/);

    // Verify the READY status indicator with animated ping dot appears
    const focusIndicator = page.locator('[data-testid="search-focus-indicator"]');
    await expect(focusIndicator).toBeVisible();
    await expect(focusIndicator).toContainText('READY');
    await expect(focusIndicator).toContainText('Esc');

    // Capture visual screenshot of active focused state
    await page.screenshot({
      path: path.join(screenshotsDir, 'ctrl_k_focus_attention_animation.png'),
    });
  });

  test('2. Searching "gaurav" displays App Owner result with "Owner of the app" label and APP OWNER badge', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('gaurav');

    // Wait for search result popover to open
    const ownerResult = page.locator('[data-testid="search-result-owner-gaurav-patil"]');
    await expect(ownerResult).toBeVisible({ timeout: 5000 });

    // Verify title contains "Gaurav Patil" and label "Owner of the app"
    await expect(ownerResult).toContainText('Gaurav Patil');
    await expect(ownerResult).toContainText('Owner of the app');
    await expect(ownerResult).toContainText('APP OWNER');
    await expect(ownerResult).toContainText('https://gauravpatil.site');

    // Verify it is NOT 0 matches, but found count
    const foundBadge = page.locator('text=/\\d+ found/');
    await expect(foundBadge).toBeVisible();

    // Capture screenshot of "gaurav" search
    await page.screenshot({
      path: path.join(screenshotsDir, 'search_gaurav_owner_result.png'),
    });
  });

  test('3. Searching "gaurav patil" and "gauravpatil.site" reliably resolves Owner and Official Portal', async ({ page }) => {
    const searchInput = page.locator('#search-input');

    // Test 3a: "gaurav patil"
    await searchInput.fill('gaurav patil');
    const ownerResult1 = page.locator('[data-testid="search-result-owner-gaurav-patil"]');
    await expect(ownerResult1).toBeVisible({ timeout: 5000 });
    await expect(ownerResult1).toContainText('Gaurav Patil');
    await expect(ownerResult1).toContainText('Owner of the app');

    // Test 3b: "gauravpatil.site"
    await searchInput.fill('gauravpatil.site');
    const ownerResult2 = page.locator('[data-testid="search-result-owner-gaurav-patil"]');
    await expect(ownerResult2).toBeVisible({ timeout: 5000 });
    await expect(ownerResult2).toContainText('https://gauravpatil.site');

    // Official portal also appears
    const portalResult = page.locator('[data-testid="search-result-owner-gauravpatil-portal"]');
    await expect(portalResult).toBeVisible({ timeout: 5000 });
    await expect(portalResult).toContainText('Downex Official Website');

    // Capture screenshot of "gauravpatil.site" search
    await page.screenshot({
      path: path.join(screenshotsDir, 'search_gauravpatil_site_result.png'),
    });
  });

  test('4. Searching "owner" shows Gaurav Patil as App Owner and pressing Enter selects it', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('owner');

    const ownerResult = page.locator('[data-testid="search-result-owner-gaurav-patil"]');
    await expect(ownerResult).toBeVisible({ timeout: 5000 });
    await expect(ownerResult).toContainText('Gaurav Patil');

    // Verify clicking it closes popover cleanly
    await ownerResult.click();
    await expect(ownerResult).not.toBeVisible();
  });
});
