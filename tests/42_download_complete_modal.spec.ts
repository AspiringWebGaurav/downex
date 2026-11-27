import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Download Complete Modal Actions (Open With + Open Folder)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('Standalone Download Complete (?window=download_complete): replaces Open File with Open Folder, keeps Open With, and avoids duplicate buttons', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.setViewportSize({ width: 540, height: 320 });
    await page.addInitScript(() => {
      (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__ = {
        id: 'complete-drishyam-2026',
        url: 'https://cdn.example.org/Drishyam-The.Conclusion.2026.4K-2160p.mkv',
        filename: 'Drishyam-The.Conclusion.2026.4K-2160p.mkv',
        destination_path: 'D:\\Drishyam-The.Conclusion.2026.4K-2160p.mkv',
        total_bytes: 18082000000,
        downloaded_bytes: 18082000000,
      };
    });

    await page.goto('/?window=download_complete');
    await expect(page.getByText('DOWNLOAD COMPLETE', { exact: true })).toBeVisible();

    // Verify Open File is removed and replaced by a single primary Open Folder button + Open With...
    await expect(page.getByRole('button', { name: 'Open File' })).toHaveCount(0);
    const openWithBtn = page.getByRole('button', { name: 'Open With...' });
    const closeBtn = page.getByRole('button', { name: 'Close', exact: true });
    const openFolderBtns = page.getByRole('button', { name: 'Open Folder' });
    const primaryOpenFolderBtn = page.getByTestId('complete-open-folder-btn');

    await expect(openWithBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();
    await expect(openFolderBtns).toHaveCount(1);
    await expect(primaryOpenFolderBtn).toBeVisible();

    // Ensure card has zero bottom clipping or vertical scroll
    const card = page.getByTestId('download-complete-card');
    const cardBox = await card.boundingBox();
    const btnBox = await primaryOpenFolderBtn.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(btnBox).not.toBeNull();
    if (cardBox && btnBox) {
      const bottomClearance = cardBox.y + cardBox.height - (btnBox.y + btnBox.height);
      expect(bottomClearance).toBeGreaterThanOrEqual(8);
    }
    const hasVerticalOverflow = await card.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(hasVerticalOverflow).toBe(false);

    // Verify Open Folder and Open With... trigger distinct actions with the exact destination path
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    // Keep test page open after action click so both handlers can be verified in one pass
    await page.evaluate(() => {
      window.close = () => {};
    });

    await openWithBtn.click();
    await expect.poll(() => dialogs.length).toBeGreaterThanOrEqual(1);
    expect(dialogs[0]).toContain('Open with...: D:\\Drishyam-The.Conclusion.2026.4K-2160p.mkv');

    await primaryOpenFolderBtn.click();
    await expect.poll(() => dialogs.length).toBeGreaterThanOrEqual(2);
    expect(dialogs[1]).toContain('Open folder: D:\\Drishyam-The.Conclusion.2026.4K-2160p.mkv');

    expect(errors).toEqual([]);
  });
});
