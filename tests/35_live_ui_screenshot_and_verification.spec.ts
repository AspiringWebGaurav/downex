import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Live UI Visual Capture & Lifecycle Verification', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Screen 1: Capture Old Application UI (Light Mode & Dark Mode)', async ({ page }) => {
    test.setTimeout(20000);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Screenshot 1: Main App UI Light Mode
    const lightPath = path.join(screenshotDir, '01_main_ui_light.png');
    await page.screenshot({ path: lightPath, fullPage: true });

    // Switch to Dark Mode
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);
      const darkPath = path.join(screenshotDir, '02_main_ui_dark.png');
      await page.screenshot({ path: darkPath, fullPage: true });
      // Switch back to light mode
      await darkToggle.click();
      await page.waitForTimeout(300);
    }
  });

  test('Screen 2: Capture Dedicated Middle UI ("Updating Apps & Services")', async ({ page }) => {
    test.setTimeout(25000);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    // 1. Stage: DOWNLOADING (45%)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'downloading',
          progress: { percentage: 45, downloaded: 4500000, total: 10000000 },
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('45%', { timeout: 3000 });
    await page.screenshot({ path: path.join(screenshotDir, '03_stage_downloading.png') });

    // 2. Stage: VERIFYING
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'verifying',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('VERIFYING', { timeout: 3000 });
    await page.screenshot({ path: path.join(screenshotDir, '04_stage_verifying.png') });

    // 3. Stage: QUEUED (User Activity Guard)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'waiting_timer',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('QUEUED', { timeout: 3000 });
    await page.screenshot({ path: path.join(screenshotDir, '05_stage_queued.png') });

    // 4. SCREEN 2: DEDICATED MIDDLE UI — "Updating Apps & Services"
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'restarting',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('RESTARTING', { timeout: 3000 });

    const bridgeModal = page.locator('[data-testid="updating-bridge-modal"]');
    await expect(bridgeModal).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="updating-bridge-title"]')).toContainText('Updating Apps & Services');

    // Capture Dedicated Middle UI in Light Mode
    const middleUiLightPath = path.join(screenshotDir, '06_middle_ui_updating_apps_and_services.png');
    await page.screenshot({ path: middleUiLightPath, fullPage: true });

    const cardEl = bridgeModal.locator('> div');
    const cardLightPath = path.join(screenshotDir, '06c_middle_ui_card_only_light.png');
    await cardEl.screenshot({ path: cardLightPath });

    // Capture Dedicated Middle UI in Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(200);
    const middleUiDarkPath = path.join(screenshotDir, '06b_middle_ui_updating_apps_and_services_dark.png');
    await page.screenshot({ path: middleUiDarkPath, fullPage: true });

    const cardDarkPath = path.join(screenshotDir, '06d_middle_ui_card_only_dark.png');
    await cardEl.screenshot({ path: cardDarkPath });

    // Revert dark mode
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    // 5. Fallback Stage: FAILED
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'error',
          errorMessage: 'Integrity check failed',
          isManualCheck: true,
        },
      });
    });
    await expect(stageEl).toContainText('FAILED', { timeout: 3000 });
    await page.screenshot({ path: path.join(screenshotDir, '07_stage_failed_fallback.png') });

    // 6. SCREEN 3: NEW APP UI (Faded in cleanly at v0.0.2)
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'idle',
        },
        currentVersion: '0.0.2',
      });
    });
    await page.waitForTimeout(300);
    const screen3Path = path.join(screenshotDir, '08_screen3_new_app_ui.png');
    await page.screenshot({ path: screen3Path, fullPage: true });
  });
});
