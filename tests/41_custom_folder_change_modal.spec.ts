import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { clearTestStorage } from './helpers/test-utils';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Custom Folder Change Modal (1:1 Unified Industrial UI)', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('New Download Modal: Browse opens unified FolderChangeModal and updates destination', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });

    // Open New Download Modal
    const newDownloadBtn = page.getByRole('button', { name: 'New Download', exact: true });
    await newDownloadBtn.click();

    // Verify New Download Modal is visible
    const newModal = page.locator('div.w-\\[450px\\]').first();
    await expect(newModal).toBeVisible();

    // Click BROWSE button inside New Download Modal
    const browseBtn = newModal.getByRole('button', { name: 'Browse', exact: true });
    await expect(browseBtn).toBeVisible();
    await browseBtn.click();

    // Verify Custom FolderChangeModal opens
    const folderModal = page.locator('[data-testid="folder-change-modal"]');
    await expect(folderModal).toBeVisible();

    // Verify unified styling & title
    await expect(folderModal.getByText('SAVE DESTINATION', { exact: true })).toBeVisible();
    await expect(folderModal.getByText('CHOOSE DOWNLOAD FOLDER', { exact: true })).toBeVisible();

    // Verify geometry matches 450px
    const folderDialog = folderModal.locator('div.w-\\[450px\\]');
    await expect(folderDialog).toBeVisible();
    const box = await folderDialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(448);
      expect(Math.round(box.width)).toBeLessThanOrEqual(452);
    }

    // Capture Light Mode Folder Change Modal from New Download
    await folderDialog.screenshot({ path: path.join(screenshotDir, 'folder_modal_01_new_download_light.png') });

    // Click 'Downloads' quick shortcut
    const downloadsShortcut = folderModal.locator('[data-testid="folder-shortcut-downloads"]');
    await downloadsShortcut.click();

    // Click SELECT FOLDER
    const selectBtn = folderModal.locator('[data-testid="folder-change-confirm-btn"]');
    await selectBtn.click();

    // Folder modal closes
    await expect(folderModal).not.toBeVisible();

    // New Download Modal destination input is updated
    const destInput = newModal.locator('input[placeholder="Destination folder path"]');
    const updatedVal = await destInput.inputValue();
    expect(updatedVal).toContain('Downloads');
  });

  test('Settings View: CHANGE FOLDER opens the exact same unified FolderChangeModal', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });

    // Navigate to Settings
    const settingsNav = page.getByRole('button', { name: 'Settings' });
    await settingsNav.click();

    // Locate CHANGE FOLDER button
    const changeFolderBtn = page.getByRole('button', { name: 'CHANGE FOLDER' });
    await expect(changeFolderBtn).toBeVisible();
    await changeFolderBtn.click();

    // Verify Custom FolderChangeModal opens
    const folderModal = page.locator('[data-testid="folder-change-modal"]');
    await expect(folderModal).toBeVisible();

    // Verify title reflects Settings usage
    await expect(folderModal.getByText('DEFAULT DOWNLOAD FOLDER', { exact: true })).toBeVisible();
    await expect(folderModal.getByText('GLOBAL APP SETTING', { exact: true })).toBeVisible();

    const folderDialog = folderModal.locator('div.w-\\[450px\\]');

    // Capture Light Mode Folder Change Modal from Settings
    await folderDialog.screenshot({ path: path.join(screenshotDir, 'folder_modal_02_settings_light.png') });

    // Switch to Dark Mode to verify dark theme parity
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(200);

    // Capture Dark Mode Folder Change Modal
    await folderDialog.screenshot({ path: path.join(screenshotDir, 'folder_modal_03_settings_dark.png') });

    // Select Documents shortcut
    const docsShortcut = folderModal.locator('[data-testid="folder-shortcut-documents"]');
    await docsShortcut.click();

    // Confirm selection
    const selectBtn = folderModal.locator('[data-testid="folder-change-confirm-btn"]');
    await selectBtn.click();

    // Modal closes cleanly
    await expect(folderModal).not.toBeVisible();

    // Settings displays feedback
    await expect(page.getByText(/Saved:/i)).toBeVisible();
  });
});
