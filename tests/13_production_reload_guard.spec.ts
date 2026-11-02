import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Production Reload Guard & Shortcut Lockdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('Development mode allows reload shortcuts and retains developer tools freedom', async ({ page }) => {
    // In dev mode (vite server), isProductionEnvironment should be false
    const isProd = await page.evaluate(() => {
      return typeof (window as any).__DOWNEX_IS_PRODUCTION__ === 'function'
        ? (window as any).__DOWNEX_IS_PRODUCTION__()
        : false;
    });
    expect(isProd).toBe(false);

    // Verify keydown on Ctrl+Shift+R is not defaultPrevented in dev
    const devPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'R',
        code: 'KeyR',
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(devPrevented).toBe(false);

    // Verify F5 is not prevented in dev
    const f5Prevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'F5',
        code: 'F5',
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(f5Prevented).toBe(false);
  });

  test('Production mode completely locks down Ctrl + Shift + R and Ctrl + F5 reload actions', async ({ page }) => {
    // Switch to simulated production mode
    await page.evaluate(() => {
      (window as any).__DOWNEX_FORCE_PRODUCTION__ = true;
      (window as any).__DOWNEX_LOCK_REFRESH__ = true;
    });

    const isLockActive = await page.evaluate(() => {
      return (window as any).__DOWNEX_IS_RELOAD_LOCK_ACTIVE__();
    });
    expect(isLockActive).toBe(true);

    // Test Ctrl + Shift + R
    const ctrlShiftRPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'R',
        code: 'KeyR',
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(ctrlShiftRPrevented).toBe(true);

    // Test Ctrl + F5
    const ctrlF5Prevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'F5',
        code: 'F5',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(ctrlF5Prevented).toBe(true);

    // Test standalone F5
    const f5Prevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'F5',
        code: 'F5',
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(f5Prevented).toBe(true);

    // Test Ctrl + R
    const ctrlRPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'r',
        code: 'KeyR',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(ctrlRPrevented).toBe(true);

    // Test multimedia BrowserRefresh
    const browserRefreshPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'BrowserRefresh',
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(browserRefreshPrevented).toBe(true);
  });

  test('Production mode preserves Ctrl + K (Search) and Ctrl + N (New Download)', async ({ page }) => {
    // Enable production lock
    await page.evaluate(() => {
      (window as any).__DOWNEX_FORCE_PRODUCTION__ = true;
      (window as any).__DOWNEX_LOCK_REFRESH__ = true;
    });

    // Test that an unrelated key (Ctrl + C) is NOT blocked by reload guard
    const ctrlCPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(ctrlCPrevented).toBe(false);

    // Dispatch Ctrl + K through Playwright keyboard to verify UI response (Search focuses)
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeFocused();

    // Test Ctrl + N opens New Download modal
    await page.keyboard.press('Control+n');
    await expect(page.getByText('New Download', { exact: false }).first()).toBeVisible();

    // Close modal with Escape
    await page.keyboard.press('Escape');
  });

  test('Production mode suppresses page context menu reload but keeps input text editing', async ({ page }) => {
    // Enable production lock
    await page.evaluate(() => {
      (window as any).__DOWNEX_FORCE_PRODUCTION__ = true;
      (window as any).__DOWNEX_LOCK_REFRESH__ = true;
    });

    // Right click on header/card should have default prevented
    const headerPrevented = await page.evaluate(() => {
      const aside = document.querySelector('aside') || document.body;
      const event = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
      aside.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(headerPrevented).toBe(true);

    // Right click inside input should NOT have default prevented
    const inputPrevented = await page.evaluate(() => {
      const input = document.getElementById('search-input') || document.querySelector('input');
      if (!input) return false;
      const event = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(inputPrevented).toBe(false);
  });
});
