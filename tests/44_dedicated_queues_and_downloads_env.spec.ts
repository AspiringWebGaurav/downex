import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Dedicated Downloads and Queues Environments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test('Adding download to queue isolates it in Queues and hides it from All Downloads until completed or unqueued', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // 1. Initial State: All Downloads should be empty
    const allNav = page.locator('aside button', { hasText: 'All Downloads' });
    await expect(allNav).toBeVisible();

    // 2. Open New Download Modal via Sidebar Add URL
    await page.click('aside button:has-text("Add URL")');
    const urlInput = page.locator('input[placeholder*="Paste download link"]');
    await expect(urlInput).toBeVisible();

    await urlInput.fill('https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso');
    await page.waitForTimeout(200);

    // Click "Later" to enqueue
    const laterBtn = page.locator('button:has-text("Later")');
    await expect(laterBtn).toBeEnabled();
    await laterBtn.click();
    await page.waitForTimeout(400);

    // 3. Should auto-navigate to Queues view
    const queuesNav = page.locator('aside button', { hasText: 'Queues' });
    await expect(queuesNav).toBeVisible();

    // 4. Queues view should display the queued download with queue tag
    const queuedCard = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04-desktop-amd64.iso' });
    await expect(queuedCard).toBeVisible();
    await expect(queuedCard.getByText('QUEUED', { exact: true })).toBeVisible();
    await expect(queuedCard.locator('span', { hasText: '#1 • Next in Line' })).toBeVisible();

    // Queued card should have Unqueue button
    const unqueueBtn = queuedCard.locator('button', { hasText: 'Unqueue' });
    await expect(unqueueBtn).toBeVisible();

    // 5. Switch to "All Downloads"
    await allNav.click();
    await page.waitForTimeout(300);

    // The queued card must NOT be displayed in All Downloads!
    await expect(queuedCard).not.toBeVisible();

    // Since all downloads are currently in queue, All Downloads shows the Queues awareness card
    const emptyCard = page.locator('[data-testid="queues-empty-state-card"]');
    await expect(emptyCard).toBeVisible();
    await expect(emptyCard.locator('p', { hasText: /organized in Queues/ })).toBeVisible();
    const openQueuesBtn = emptyCard.locator('button', { hasText: /Open Queues/ }).first();
    await expect(openQueuesBtn).toBeVisible();

    // 6. Click Open Queues button from the awareness card
    await openQueuesBtn.click();
    await page.waitForTimeout(300);
    await expect(queuedCard).toBeVisible();

    // 7. Click "Unqueue" on the card
    await unqueueBtn.click();
    await page.waitForTimeout(400);

    // After unqueueing, switch back to All Downloads
    await allNav.click();
    await page.waitForTimeout(300);

    // The unqueued download is now PAUSED and visible in All Downloads!
    const unqueuedInAll = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04-desktop-amd64.iso' });
    await expect(unqueuedInAll).toBeVisible();
    await expect(unqueuedInAll.getByText('PAUSED', { exact: true })).toBeVisible();

    // Queues view should now be empty of queued items
    await queuesNav.click();
    await page.waitForTimeout(300);
    const walkthrough = page.locator('h3', { hasText: 'How 1-by-1 Queue Works' });
    await expect(walkthrough).toBeVisible();
  });

  test('Completed download from queue automatically graduates to All Downloads', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // Open New Download Modal
    await page.click('aside button:has-text("Add URL")');
    const urlInput = page.locator('input[placeholder*="Paste download link"]');
    await expect(urlInput).toBeVisible();

    await urlInput.fill('https://example.com/debian-12.0.0-amd64-netinst.iso');
    await page.waitForTimeout(200);

    const laterBtn = page.locator('button:has-text("Later")');
    await laterBtn.click();
    await page.waitForTimeout(400);

    // Simulate completion of this download in store
    await page.evaluate(() => {
      const state = (window as any).useDownloadStore?.getState?.();
      if (state && state.items.length > 0) {
        const item = state.items[0];
        (window as any).useDownloadStore.setState({
          items: [
            {
              ...item,
              status: 'completed',
              downloaded_bytes: item.total_bytes || 500000000,
              speed_bytes_sec: 0,
              eta_seconds: 0,
            },
          ],
        });
      }
    });

    // Navigate to All Downloads
    const allNav = page.locator('aside button', { hasText: 'All Downloads' });
    await allNav.click();
    await page.waitForTimeout(300);

    // Completed download must now be visible in All Downloads!
    const completedCard = page.locator('div.rounded-xl', { hasText: 'debian-12.0.0-amd64-netinst.iso' });
    await expect(completedCard).toBeVisible();
    await expect(completedCard.getByText('COMPLETED', { exact: true })).toBeVisible();
  });

  test('Queues awareness banner displays in All Downloads when other active downloads exist', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });

    // 1. Add active download
    await page.click('aside button:has-text("Add URL")');
    const urlInput1 = page.locator('input[placeholder*="Paste download link"]');
    await expect(urlInput1).toBeVisible();
    await urlInput1.fill('https://example.com/active-stream-file.zip');
    await page.waitForTimeout(200);
    const startNowBtn = page.locator('button:has-text("Start Download")');
    await startNowBtn.click();
    await page.waitForTimeout(400);

    // 2. Add queued download
    await page.click('aside button:has-text("Add URL")');
    const urlInput2 = page.locator('input[placeholder*="Paste download link"]');
    await expect(urlInput2).toBeVisible();
    await urlInput2.fill('https://example.com/second-queued-file.iso');
    await page.waitForTimeout(200);
    const laterBtn = page.locator('button:has-text("Later")');
    await laterBtn.click();
    await page.waitForTimeout(400);

    // 3. Navigate to All Downloads
    const allNav = page.locator('aside button', { hasText: 'All Downloads' });
    await allNav.click();
    await page.waitForTimeout(300);

    // Active file should be visible
    await expect(page.locator('div.rounded-xl', { hasText: 'active-stream-file.zip' })).toBeVisible();
    // Queued file should NOT be in the cards
    await expect(page.locator('div.rounded-xl', { hasText: 'second-queued-file.iso' })).not.toBeVisible();

    // Top banner for queued items must be visible
    const topBanner = page.locator('[data-testid="queues-awareness-banner"]');
    await expect(topBanner).toBeVisible();
    await expect(topBanner.locator('button', { hasText: 'Open Queues' })).toBeVisible();

    // Click Open Queues from top banner
    await topBanner.locator('button', { hasText: 'Open Queues' }).click();
    await page.waitForTimeout(300);

    // Should now be on Queues view showing second-queued-file.iso
    await expect(page.locator('div.rounded-xl', { hasText: 'second-queued-file.iso' })).toBeVisible();
  });
});
