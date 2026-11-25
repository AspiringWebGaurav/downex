import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Dev Refresh Tab Persistence & Production Lockdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.waitForLoadState('networkidle');
  });

  test('Session Mode: Active tab persists across reloads while running, with zero localStorage hard persistence', async ({ page, context }) => {
    // Seed a legacy hard-persisted tab in localStorage to ensure it is purged on boot
    await page.evaluate(() => {
      localStorage.setItem('downex_dev_selected_view', 'trash');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 1. Fresh boot starts on All Downloads and clears legacy localStorage key
    await expect(page.locator('button:has-text("All Downloads")')).toBeVisible();
    const legacyAfterBoot = await page.evaluate(() => localStorage.getItem('downex_dev_selected_view'));
    expect(legacyAfterBoot).toBeNull();

    // 2. Navigate to Settings
    const settingsBtn = page.locator('button:has-text("Settings")');
    await settingsBtn.click();
    await expect(page.locator('h1:has-text("Settings.")')).toBeVisible();

    // Verify sessionStorage (not localStorage) holds 'settings' while running
    const sessionView1 = await page.evaluate(() => sessionStorage.getItem('downex_session_selected_view'));
    const hardView1 = await page.evaluate(() => localStorage.getItem('downex_dev_selected_view'));
    expect(sessionView1).toBe('settings');
    expect(hardView1).toBeNull();

    // 3. Simulate Refresh while running (preserves sessionStorage)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify that after refresh while running, Settings remains the active tab
    await expect(page.locator('h1:has-text("Settings.")')).toBeVisible();
    await expect(page.locator('text=Start with Windows')).toBeVisible();
    const currentViewAfterReload = await page.evaluate(() => {
      return (window as any).useDownloadStore?.getState().selectedView;
    });
    expect(currentViewAfterReload).toBe('settings');

    // 4. Navigate to Queues
    const queuesBtn = page.locator('button:has-text("Queues")');
    await queuesBtn.click();
    await expect(page.locator('button:has-text("Add Download to Queue")')).toBeVisible();

    const sessionView2 = await page.evaluate(() => sessionStorage.getItem('downex_session_selected_view'));
    expect(sessionView2).toBe('queues');

    // 5. Refresh while running again
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify Queues remains active!
    await expect(page.locator('button:has-text("Add Download to Queue")')).toBeVisible();
    const currentViewQueues = await page.evaluate(() => {
      return (window as any).useDownloadStore?.getState().selectedView;
    });
    expect(currentViewQueues).toBe('queues');

    // 6. Navigate to Speed & Stats (telemetry)
    const statsBtn = page.locator('button:has-text("Speed & Stats")');
    await statsBtn.click();
    await expect(page.locator('text=Live Speed & System Details')).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Live Speed & System Details')).toBeVisible();
    const currentViewStats = await page.evaluate(() => {
      return (window as any).useDownloadStore?.getState().selectedView;
    });
    expect(currentViewStats).toBe('telemetry');

    // 7. Navigate back to All Downloads
    const allDownloadsBtn = page.locator('button:has-text("All Downloads")');
    await allDownloadsBtn.click();
    const sessionViewAll = await page.evaluate(() => sessionStorage.getItem('downex_session_selected_view'));
    expect(sessionViewAll).toBe('all');

    // 8. Simulate fresh app/system restart (new page/session without prior sessionStorage) -> opens fresh on 'all'
    const freshPage = await context.newPage();
    await freshPage.goto('/');
    await freshPage.waitForLoadState('networkidle');
    const freshView = await freshPage.evaluate(() => (window as any).useDownloadStore?.getState().selectedView);
    expect(freshView).toBe('all');
    await freshPage.close();
  });

  test('Production Mode: Reload shortcuts remain strictly locked down', async ({ page }) => {
    // Switch to simulated production environment
    await page.evaluate(() => {
      (window as any).__DOWNEX_FORCE_PRODUCTION__ = true;
      (window as any).__DOWNEX_LOCK_REFRESH__ = true;
    });

    const isProd = await page.evaluate(() => {
      return (window as any).__DOWNEX_IS_PRODUCTION__();
    });
    expect(isProd).toBe(true);

    const isLockActive = await page.evaluate(() => {
      return (window as any).__DOWNEX_IS_RELOAD_LOCK_ACTIVE__();
    });
    expect(isLockActive).toBe(true);

    // Verify Ctrl + Shift + R is locked (defaultPrevented = true)
    const ctrlShiftR = await page.evaluate(() => {
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
    expect(ctrlShiftR).toBe(true);

    // Verify Ctrl + F5 is locked
    const ctrlF5 = await page.evaluate(() => {
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
    expect(ctrlF5).toBe(true);

    // Verify standalone F5 is locked
    const f5 = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'F5',
        code: 'F5',
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(f5).toBe(true);
  });
});
