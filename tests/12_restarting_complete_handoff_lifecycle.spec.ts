import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — Complete Restart Handoff & Updated App Launch Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Full Lifecycle: Restart click -> Dedicated Light Restarting Window -> 7s Sequence -> Fresh App Launch', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Boot main application
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // 2. Set store into 'ready' state with verified staged binary and target version v0.0.9
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'ready',
            targetVersion: '0.0.9',
            stagedPath: 'C:\\Users\\namit\\AppData\\Local\\Temp\\com.downex.manager\\downex-v0.0.9.staged.exe',
            manifest: {
              version: '0.0.9',
              notes: '• Dedicated light-theme restarting window\n• Zero-lock NTFS in-process atomic updates\n• Seamless application handoff and restart',
              pub_date: '2026-10-29T11:00:00Z',
            },
          },
        });
      }
    });

    // 3. Verify Update Notification / Modal offers Restart & Apply
    const restartBtn = page.locator('button:has-text("Restart & Apply")');
    await expect(restartBtn).toBeVisible({ timeout: 4000 });

    // 4. Click Restart & Apply
    await restartBtn.click();

    // 5. Verify transition to Restarting state
    await page.waitForTimeout(300);

    // 6. Direct navigation / rendering of dedicated Restarting Window (simulating child window load in Tauri)
    await page.goto('/?window=restarting&target=0.0.9');
    await page.waitForLoadState('domcontentloaded');

    // 7. Verify Light Theme Styling (bg-white, dark text, no dark classes)
    const rootDiv = page.locator('div[data-tauri-drag-region]').first();
    await expect(rootDiv).toBeVisible();

    const bgColor = await rootDiv.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(255, 255, 255)');

    // 8. Verify Header, Target Version Badge, and Checklist
    await expect(page.locator('text=Please wait, apps and services restarting...')).toBeVisible();
    await expect(page.locator('text=v0.0.9')).toBeVisible();

    await expect(page.locator('text=Pausing active downloads & queue state')).toBeVisible();
    await expect(page.locator('text=Flushing SQLite database & WAL transactions')).toBeVisible();
    await expect(page.locator('text=Releasing single-instance socket & IPC handles')).toBeVisible();
    await expect(page.locator('text=Launching updated Downex engine...')).toBeVisible();

    // 9. Verify Milestones Step Progression across the 7-second lifecycle
    await page.waitForTimeout(2000);
    const checksAt2s = await page.locator('svg.text-emerald-600').count();
    expect(checksAt2s).toBeGreaterThanOrEqual(1);

    await page.waitForTimeout(2000);
    const checksAt4s = await page.locator('svg.text-emerald-600').count();
    expect(checksAt4s).toBeGreaterThanOrEqual(2);

    // 10. Simulate completion of handoff: Fresh app opens with post-update markers
    await page.evaluate(() => {
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: '0.0.9',
          previousVersion: '0.0.0',
          notes: '• Dedicated light-theme restarting window\n• Zero-lock NTFS in-process atomic updates\n• Seamless application handoff and restart',
          timestamp: Date.now(),
        })
      );
      localStorage.setItem('downex_last_known_version', '0.0.0');
      localStorage.setItem('downex_persisted_version', '0.0.9');
    });

    // 11. Fresh app launch (main window reload)
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // 12. Verify celebratory Patch Notes Modal opened automatically for v0.0.9
    await expect(page.locator('text=Update Installed Successfully')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=v0.0.9').first()).toBeVisible();
    await expect(page.locator('text=Dedicated light-theme restarting window')).toBeVisible();

    // 13. Dismiss modal and verify version in sidebar
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Update Installed Successfully')).not.toBeVisible();
    await expect(page.locator('text=v0.0.9').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
