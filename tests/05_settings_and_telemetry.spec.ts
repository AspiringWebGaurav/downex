import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex Base Application — Settings View & Hardware Telemetry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Navigate to Settings view and verify hardware telemetry sensors', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Click Settings in sidebar
    await page.click('button:has-text("Settings")');

    // Header & Section titles
    await expect(page.getByRole('heading', { name: 'Downex Preferences & System Telemetry' })).toBeVisible();
    await expect(page.locator('text=Live Engine Performance & Storage Telemetry')).toBeVisible();

    // Telemetry sensor cards in embedded view
    await expect(page.locator('text=Total Bandwidth').first()).toBeVisible();
    await expect(page.locator('text=Active Engine Sockets')).toBeVisible();
    await expect(page.locator('text=Storage Target').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Preferences toggles (Telemetry Sidebar, Clipboard Watch, Tray Minimization)', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');

    // 1. Toggle Show Telemetry Sidebar on Homepage
    const telemetrySidebarToggle = page.locator('div:has(> div:has-text("Show Telemetry Sidebar on Homepage")) > button');
    await telemetrySidebarToggle.click();

    // Verify "Saved" pill appears
    await expect(page.locator('text=Saved')).toBeVisible();

    // Switch back to "All Downloads" and verify sidebar telemetry is rendered
    await page.click('button:has-text("All Downloads")');
    await expect(page.locator('text=Active Sockets')).toBeVisible();

    // Go back to Settings and turn it off
    await page.click('button:has-text("Settings")');
    await telemetrySidebarToggle.click();
    await page.click('button:has-text("All Downloads")');
    await expect(page.locator('text=Active Sockets')).not.toBeVisible();

    // 2. Test Clipboard URL Auto-Detection toggle
    await page.click('button:has-text("Settings")');
    const clipboardToggle = page.locator('div:has(> div:has-text("Clipboard URL Auto-Detection")) > button');
    await clipboardToggle.click();

    let clipboardPref = await page.evaluate(() => localStorage.getItem('downex_clipboard_watch'));
    expect(clipboardPref).toBe('true');

    await clipboardToggle.click();
    clipboardPref = await page.evaluate(() => localStorage.getItem('downex_clipboard_watch'));
    expect(clipboardPref).toBe('false');

    // 3. Test Minimize to System Tray toggle
    const trayToggle = page.locator('div:has(> div:has-text("Minimize to System Tray on Close")) > button');
    await trayToggle.click();

    let trayPref = await page.evaluate(() => localStorage.getItem('downex_close_to_tray'));
    expect(trayPref).toBe('false');

    await trayToggle.click();
    trayPref = await page.evaluate(() => localStorage.getItem('downex_close_to_tray'));
    expect(trayPref).toBe('true');

    expect(errors).toEqual([]);
  });

  test('Max Parallel Sockets per File segment buttons and default directory picker', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');

    // 1. Max segments selector buttons: 4, 8, 16, 32
    const btn8 = page.locator('button:has-text("8")');
    await btn8.click();

    let savedSegments = await page.evaluate(() => localStorage.getItem('downex_max_segments'));
    expect(savedSegments).toBe('8');

    const btn16 = page.locator('button:has-text("16")');
    await btn16.click();

    savedSegments = await page.evaluate(() => localStorage.getItem('downex_max_segments'));
    expect(savedSegments).toBe('16');

    // 2. Browse Folder button triggers folder picker feedback
    const browseFolderBtn = page.getByRole('button', { name: 'Browse Folder...' });
    await browseFolderBtn.click();

    // Verify feedback message
    await expect(page.locator('text=New downloads will save to:')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
