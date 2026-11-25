import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Downex — Native Win32 Updater Pipeline & Zero In-Window Modal Verification', () => {
  const screenshotsDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-testid="sidebar-version"]', { timeout: 15000 });
  });

  test('1. Zero In-Window Modal: Dev QA OTA controls never render in-window modal overlay', async ({ page }) => {
    // Open Dev QA
    const qaTrigger = page.locator('button:has-text("Dev QA")').first();
    await expect(qaTrigger).toBeVisible();
    await qaTrigger.click();

    // Switch to OTA Updates tab
    const otaTab = page.getByRole('button', { name: 'OTA Updates', exact: true });
    await expect(otaTab).toBeVisible();
    await otaTab.click();

    // Click "Middle Card" preview button
    const middleCardBtn = page.locator('[data-testid="dev-qa-preview-middle-card"]');
    await expect(middleCardBtn).toBeVisible();
    await middleCardBtn.click();

    // Verify STRICT ZERO IN-WINDOW MODAL inside the webview
    const inWindowModal = page.locator('[data-testid="simulated-updater-card"]');
    await expect(inWindowModal).toHaveCount(0);

    // Verify feedback toast confirms native Win32 execution
    const toast = page.locator('text=Spawning native Win32 floating updater preview on desktop');
    await expect(toast).toBeVisible({ timeout: 3000 });

    // Verify app background is completely clean and unobstructed
    const backdropOverlay = page.locator('.fixed.inset-0.bg-black\\/40');
    await expect(backdropOverlay).toHaveCount(0);

    // Capture clean screen
    await page.screenshot({
      path: path.join(screenshotsDir, 'middle_updater_zero_in_window_modal.png'),
    });
  });

  test('2. "Run Full Real-As-Mock OTA" executes 1-100% download and completes with zero modal spam', async ({ page }) => {
    // Open Dev QA
    const qaTrigger = page.locator('button:has-text("Dev QA")').first();
    await expect(qaTrigger).toBeVisible();
    await qaTrigger.click();

    // Switch to OTA Updates tab
    const otaTab = page.getByRole('button', { name: 'OTA Updates', exact: true });
    await expect(otaTab).toBeVisible();
    await otaTab.click();

    // Click "Run Full Real-As-Mock OTA"
    const runFullBtn = page.locator('[data-testid="dev-qa-run-full-ota"]');
    await expect(runFullBtn).toBeVisible();
    await runFullBtn.click();

    // 1. Observe Download Stage (1-100%)
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toContainText(/(\d+)%/, { timeout: 3000 });

    // 2. Verify NO in-window modal appears during entire pipeline
    const inWindowModal = page.locator('[data-testid="simulated-updater-card"]');
    await expect(inWindowModal).toHaveCount(0);

    // 3. Wait for progression to complete
    const versionRow = page.locator('[data-testid="sidebar-version"]');
    await expect(versionRow).toContainText('0.0.2', { timeout: 12000 });

    // 4. Verify Up to Date badge displays cleanly in sidebar version stage
    const upToDateBadge = page.locator('[data-testid="sidebar-version-stage"]').locator('text=UP TO DATE');
    await expect(upToDateBadge).toBeVisible({ timeout: 5000 });

    // Capture successful completed state
    await page.screenshot({
      path: path.join(screenshotsDir, 'full_ota_mock_completed_v002.png'),
    });
  });
});
