import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Instant Modal & Dialog Responsiveness (IDM Performance Standard)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('New Download Modal opens instantaneously on frame 0 with pre-warmed path and storage', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // Click "+ New Download" button
    const newDownloadBtn = page.locator('button', { hasText: 'New Download' }).first();
    const startTime = Date.now();
    await newDownloadBtn.click();

    // Modal dialog must be visible almost instantly
    const modal = page.locator('div.fixed.inset-0').locator('text=Download File');
    await expect(modal).toBeVisible({ timeout: 600 });
    const openElapsed = Date.now() - startTime;
    console.log(`[Perf] New Download modal visible in: ${openElapsed}ms`);
    expect(openElapsed).toBeLessThan(650);

    // Verify Save To input is already pre-warmed on frame 0 (non-empty)
    const saveToInput = page.locator('input[placeholder="Destination folder path"]').first();
    const saveVal = await saveToInput.inputValue();
    expect(saveVal.length).toBeGreaterThan(0);
    console.log(`[Pre-warm] Initial save path: "${saveVal}"`);

    // Verify free space badge is already visible without layout shift
    const freeSpaceText = page.locator('text=free space');
    await expect(freeSpaceText).toBeVisible();

    // Close via Esc
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 500 });

    // Test rapid repeated reopen (hot cache benchmark)
    const reopenStart = Date.now();
    await newDownloadBtn.click();
    await expect(modal).toBeVisible({ timeout: 300 });
    const reopenElapsed = Date.now() - reopenStart;
    console.log(`[Perf] Repeated reopen visible in: ${reopenElapsed}ms`);
    expect(reopenElapsed).toBeLessThan(300);

    // Close via Cancel button
    const cancelBtn = page.locator('button', { hasText: 'Cancel' });
    await cancelBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 500 });
  });

  test('Delete Confirm Modal opens instantaneously and dismisses cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // Seed 1 completed download item
    await page.evaluate(() => {
      const mockItem = {
        id: 'mock-del-test',
        url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
        filename: 'ubuntu-24.04-desktop-amd64.iso',
        status: 'completed',
        total_bytes: 6144000000,
        downloaded_bytes: 6144000000,
        speed_bytes_sec: 0,
        destination_path: 'C:\\Downloads\\ubuntu-24.04-desktop-amd64.iso',
        created_at: Date.now() - 10000,
      };
      const store = (window as any).useDownloadStore;
      if (store) {
        store.setState({ items: [mockItem] });
      }
    });

    // Hover row and click delete button
    const deleteBtn = page.locator('button[title*="Delete"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 1000 });

    const startTime = Date.now();
    await deleteBtn.click();

    // Delete modal appears instantly
    const deleteModal = page.locator('div.fixed.inset-0').locator('text=Delete Download');
    await expect(deleteModal).toBeVisible({ timeout: 400 });
    const openElapsed = Date.now() - startTime;
    console.log(`[Perf] Delete confirm modal visible in: ${openElapsed}ms`);
    expect(openElapsed).toBeLessThan(400);

    // Cancel dismisses immediately
    const cancelBtn = page.locator('button', { hasText: 'Cancel' });
    await cancelBtn.click();
    await expect(deleteModal).not.toBeVisible({ timeout: 300 });
  });

  test('Download Complete Dialog Window route renders completed details immediately without loading spinner block', async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 420 });

    // Navigate directly to download-complete window URL
    const startTime = Date.now();
    await page.goto('/?window=download_complete');

    // Title and completed summary should be visible immediately
    const title = page.getByText('Download complete', { exact: true });
    await expect(title).toBeVisible({ timeout: 600 });

    const elapsed = Date.now() - startTime;
    console.log(`[Perf] Download Complete window route ready in: ${elapsed}ms`);

    // Verify loading spinner is NOT stuck
    const loadingText = page.locator('text=Loading download details');
    await expect(loadingText).not.toBeVisible();

    // Action buttons must be immediately interactive
    const openFolderBtn = page.locator('button', { hasText: 'Open Folder' });
    await expect(openFolderBtn).toBeVisible();
    await expect(openFolderBtn).toBeEnabled();

    // Verify "Don't show this dialog again" is removed
    await expect(page.locator('text=Don\'t show this dialog again')).not.toBeVisible();

    // Verify one-view footer status
    await expect(page.locator('text=Show Downex')).not.toBeVisible();

    // Verify no vertical scrollbar (one-view standard)
    const isScrollable = await page.evaluate(() => {
      const card = document.querySelector('.overflow-hidden');
      return card ? card.scrollHeight > card.clientHeight : false;
    });
    expect(isScrollable).toBe(false);
  });

  test('Download Dialog Window route renders pre-warmed storage and download info instantly', async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 480 });

    const startTime = Date.now();
    await page.goto('/?window=download_dialog');

    // Dialog title
    const title = page.locator('text=Download File');
    await expect(title).toBeVisible({ timeout: 600 });
    const elapsed = Date.now() - startTime;
    console.log(`[Perf] Download Dialog window route ready in: ${elapsed}ms`);

    // Pre-warmed save path should be filled immediately
    const saveInput = page.locator('input[placeholder="Destination folder path"]').first();
    await expect(saveInput).toHaveValue(/.+/);

    // Start download button is ready
    const startBtn = page.locator('button', { hasText: 'Start Download' });
    await expect(startBtn).toBeVisible();
  });
});
