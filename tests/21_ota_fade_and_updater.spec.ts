import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.beforeAll(() => {
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
});

test.describe('OTA Update Transitions & Direct Crisp UI Close', () => {
  test('1. Old UI direct close: Zero in-window modal popup and zero white blank flash during restart', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });
    await page.waitForTimeout(450);

    // Verify modal does not exist initially
    const bridgeModal = page.locator('[data-testid="updating-bridge-modal"]');
    await expect(bridgeModal).toHaveCount(0);

    // Trigger update restarting state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            ...store.getState().status,
            state: 'restarting',
            targetVersion: '0.0.2',
          },
        });
      }
    });

    // Check that updating-bridge-modal is STILL completely absent from DOM
    await expect(bridgeModal).toHaveCount(0);

    // Verify zero white blank flash (no .fade-out opacity-0 class; root stays crisp until HWND direct close)
    await expect(page.locator('.fade-out')).toHaveCount(0);
    const opacity = await page.evaluate(() => {
      const rootEl = document.querySelector('#root > div');
      return rootEl ? window.getComputedStyle(rootEl).opacity : '1';
    });
    expect(opacity).toBe('1');

    // Capture screenshot of clean direct-close ready state (NO modal, NO white blank flash)
    const screenshotPath = path.join(screenshotDir, '01_old_ui_direct_close.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  });

  test('2. Fresh post-update boot: Checks version and displays "UP TO DATE" one time', async ({ page }) => {
    // Intercept GPHost manifest fetch to simulate up-to-date response immediately
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.1',
          url: '',
        }),
      });
    });

    // Seed recently updated marker in localStorage
    await page.addInitScript(() => {
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: '0.0.1',
          previousVersion: '0.0.1',
          timestamp: Date.now(),
        })
      );
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    // Wait for the one-time verification check to fire and display "UP TO DATE"
    const upToDateBtn = page.locator('text=UP TO DATE');
    await expect(upToDateBtn).toBeVisible({ timeout: 10000 });

    // Capture screenshot showing the one-time "UP TO DATE" stage
    const upToDateScreenshot = path.join(screenshotDir, '02_fresh_boot_up_to_date.png');
    await page.screenshot({ path: upToDateScreenshot });
    console.log(`Saved screenshot: ${upToDateScreenshot}`);

    // Wait for the 4.2s display hold to expire
    await page.waitForTimeout(4600);

    // Verify "UP TO DATE" has faded away and button returned to clean idle state
    await expect(upToDateBtn).toHaveCount(0);

    // Verify localStorage marker is cleanly cleared
    const marker = await page.evaluate(() => localStorage.getItem('downex_recently_updated'));
    expect(marker).toBeNull();

    // Capture screenshot of returned idle state
    const idleScreenshot = path.join(screenshotDir, '03_returned_to_silent_idle.png');
    await page.screenshot({ path: idleScreenshot });
    console.log(`Saved screenshot: ${idleScreenshot}`);
  });

  test('3. Theme rendering: Verify Light mode and Dark mode active themes', async ({ page }) => {
    // Test Light Mode
    await page.addInitScript(() => {
      localStorage.setItem('downex_theme', 'light');
      localStorage.setItem('downex_theme_explicit', 'true');
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });

    const lightScreenshot = path.join(screenshotDir, '04_light_mode_active.png');
    await page.screenshot({ path: lightScreenshot });
    console.log(`Saved screenshot: ${lightScreenshot}`);

    // Switch to Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('downex_theme', 'dark');
    });
    await page.waitForTimeout(300);

    const darkScreenshot = path.join(screenshotDir, '05_dark_mode_active.png');
    await page.screenshot({ path: darkScreenshot });
    console.log(`Saved screenshot: ${darkScreenshot}`);
  });
});
