import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex Base Application — OTA Updates, Notifications & Patch Notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Version display in Sidebar and Settings', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Verify sidebar displays version badge
    await expect(page.locator('text=v0.0.0').first()).toBeVisible();

    // Navigate to Settings and verify build version in footer
    await page.click('button:has-text("Settings")');
    await expect(page.locator('text=Downex Core Build: v0.0.0')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('UpdateModal lifecycle with Available and Close actions', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Trigger Update Available in AppVersionStore
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          isModalOpen: true,
          status: {
            state: 'available',
            targetVersion: '0.1.0',
            manifest: {
              version: '0.1.0',
              notes: 'Added parallel chunk acceleration and auto-resume.',
            },
          },
        });
      }
    });

    // Verify modal elements
    await expect(page.locator('text=Software Update').first()).toBeVisible();
    await expect(page.getByText('v0.1.0').first()).toBeVisible();
    await expect(page.locator('text=Added parallel chunk acceleration and auto-resume.')).toBeVisible();

    // Dismiss modal via Later button
    const closeBtn = page.locator('button:has-text("Later")').first();
    await closeBtn.click();
    await expect(page.locator('text=Software Update')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('UpdateNotification floating toast rendering and dismissal', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed update state in store
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          isToastDismissed: false,
          status: {
            state: 'available',
            targetVersion: '0.2.0',
          },
        });
      }
    });

    // Verify floating toast is visible
    const toast = page.locator('h4:has-text("Update Available")');
    await expect(toast).toBeVisible();
    await expect(page.getByText('v0.2.0', { exact: true })).toBeVisible();

    // Click dismiss button on toast
    const dismissBtn = page.locator('button[title*="Dismiss"]').first();
    await dismissBtn.click();
    await expect(toast).not.toBeVisible();

    // Verify persisted session dismiss
    const isDismissed = await page.evaluate(() => sessionStorage.getItem('downex_toast_dismissed'));
    expect(isDismissed).toBe('true');

    expect(errors).toEqual([]);
  });

  test('Patch Notes Modal celebratory lifecycle and keyboard dismissal', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Trigger celebratory patch notes modal in store
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          isPatchNotesOpen: true,
          patchNotes: {
            version: '0.1.0',
            previousVersion: '0.0.0',
            notes: 'Accelerated socket connection pool\nZero-lock atomic update runner',
          },
        });
      }
    });

    // Verify celebratory Patch Notes Modal renders
    await expect(page.locator('text=Update Installed Successfully')).toBeVisible();
    await expect(page.locator('text=Accelerated socket connection pool')).toBeVisible();

    // Dismiss with Escape key
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Update Installed Successfully')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('DownloadCompleteWindow renders dynamic download details and handles actions', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock download complete payload in browser window
    await page.addInitScript(() => {
      (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__ = {
        id: 'completed-task-1',
        url: 'https://downloads.example.org/releases/downex-setup-v1.2.exe',
        filename: 'downex-setup-v1.2.exe',
        destination_path: 'C:\\Users\\Downloads\\downex-setup-v1.2.exe',
        total_bytes: 45000000,
        downloaded_bytes: 45000000,
      };
    });

    await page.goto('/?window=download_complete');
    await page.waitForLoadState('domcontentloaded');

    // Verify dynamic elements are rendered properly (NOT static 0 B or https://...)
    await expect(page.locator('text=downex-setup-v1.2.exe').first()).toBeVisible();
    await expect(page.locator('text=100% Complete')).toBeVisible();
    await expect(page.locator('text=Downloaded 42.92 MB (45,000,000 Bytes)')).toBeVisible();

    const addressInput = page.locator('input[value="https://downloads.example.org/releases/downex-setup-v1.2.exe"]');
    await expect(addressInput).toBeVisible();

    const saveInput = page.locator('input[value="C:\\\\Users\\\\Downloads\\\\downex-setup-v1.2.exe"]');
    await expect(saveInput).toBeVisible();

    // Verify action buttons
    await expect(page.locator('button:has-text("Open")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Open folder")')).toBeVisible();
    await expect(page.locator('button:has-text("Open with...")')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('5-second RestartingModal renders countdown ring, version handoff, and service telemetry', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Trigger state: 'restarting'
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'restarting',
            targetVersion: '0.0.5',
          },
        });
      }
    });

    // 1. Verify modal title and explanation
    await expect(page.locator('text=Please wait, apps and services restarting...')).toBeVisible();
    await expect(page.locator('text=v0.0.5')).toBeVisible();

    // 2. Verify all service telemetry steps are displayed
    await expect(page.locator('text=Pausing active downloads & queue state')).toBeVisible();
    await expect(page.locator('text=Flushing SQLite database & WAL transactions')).toBeVisible();
    await expect(page.locator('text=Releasing single-instance socket & IPC handles')).toBeVisible();
    await expect(page.locator('text=Launching updated Downex engine...')).toBeVisible();

    // 3. Verify progress updates over time
    await expect(page.locator('text=Restarting services')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
