import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex Base Application — Startup, Lifecycle & Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Application initializes cleanly with zero console errors and renders core layout', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await expect(page.getByText('DOWNEX', { exact: true })).toBeVisible();
    await expect(page.getByText('v0.0.0').first()).toBeVisible();

    // Verify window header, sidebar, search bar, and action button
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('button:has-text("New Download")')).toBeVisible();

    // Verify empty state is rendered initially
    await expect(page.locator('text=No downloads found')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Dark / Light theme lifecycle toggles document classes and persists to storage', async ({ page }) => {
    // By default, document should not have dark class
    const isInitiallyDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isInitiallyDark).toBe(false);

    // Click theme toggle button in sidebar
    const themeBtn = page.locator('button:has-text("Dark Mode"), button:has-text("Light Mode")');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();

    // Should now be dark
    await expect.poll(async () => {
      return await page.evaluate(() => document.documentElement.classList.contains('dark'));
    }).toBe(true);

    const savedTheme = await page.evaluate(() => localStorage.getItem('downex_theme'));
    expect(savedTheme).toBe('dark');

    // Reload page to verify persistence across restarts
    await page.reload();
    const isDarkAfterReload = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDarkAfterReload).toBe(true);

    // Toggle back to light
    const lightBtn = page.locator('button:has-text("Light Mode")');
    await lightBtn.click();
    await expect.poll(async () => {
      return await page.evaluate(() => document.documentElement.classList.contains('dark'));
    }).toBe(false);
  });

  test('Keyboard shortcuts: Ctrl+K focuses search, Ctrl+B toggles sidebar, Ctrl+N opens modal', async ({ page }) => {
    // Ensure document has active window focus
    await page.locator('body').click();

    // 1. Ctrl+K focuses search input
    await page.keyboard.press('Control+k');
    await expect(page.locator('#search-input')).toBeFocused();

    // 2. Ctrl+B toggles sidebar collapse/expand
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/w-\[196px\]/);
    await page.keyboard.press('Control+b');
    await expect(sidebar).toHaveClass(/w-14/);
    await page.keyboard.press('Control+b');
    await expect(sidebar).toHaveClass(/w-\[196px\]/);

    // 3. Test Ctrl+N keyboard shortcut event opens New Download Modal
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    });
    await expect(page.locator('text=Download File')).toBeVisible();
    await expect(page.locator('input[placeholder="Filename"]')).toBeVisible();

    // Escape closes modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Download File')).not.toBeVisible();

    // 4. Also verify clicking "+ New Download" button opens modal
    await page.click('button:has-text("New Download")');
    await expect(page.locator('text=Download File')).toBeVisible();
    await page.click('button[title="Close (Esc)"]');
    await expect(page.locator('text=Download File')).not.toBeVisible();
  });

  test('Component mounting and unmounting stress across rapid view switches', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Switch rapidly between All Downloads, Queues, Completed, Settings, Trash
    const views = ['Queues', 'Completed', 'Settings', 'Trash', 'All Downloads'];
    for (let loop = 0; loop < 3; loop++) {
      for (const view of views) {
        await page.click(`aside button:has-text("${view}")`);
        await page.waitForTimeout(50);
      }
    }

    // Verify main app remains stable
    await expect(page.locator('#search-input')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
