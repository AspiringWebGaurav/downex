import { test, expect } from '@playwright/test';
import { captureConsoleErrors, clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Transfer Rate & Full Lifecycle (Accept, Reject, Error, Queue, Done)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Active Download Phase: Transfer rate renders whole integer MB/s without decimal noise', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed mock active downloads:
    // 1. 24,536,678 bytes/sec (~23.4 MB/s, ~196 Mbps) -> Should render 23 MB/s, NOT 23.4 MB/s
    // 2. 10,590,617 bytes/sec (~10.1 MB/s, ~85 Mbps) -> Should render 10 MB/s, NOT 10.1 MB/s
    // 3. 461,824 bytes/sec (~451 KB/s, ~4 Mbps) -> Should render 451 KB/s, NOT 451.0 KB/s
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'dl-rate-23mb',
          url: 'https://downloads.example.org/ubuntu-24.04.iso',
          filename: 'ubuntu-24.04.iso',
          destination_path: 'C:\\Downloads\\ubuntu-24.04.iso',
          total_bytes: 5000000000,
          downloaded_bytes: 1500000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 24536678, // ~23.4 MB/s
          eta_seconds: 142,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'dl-rate-10mb',
          url: 'https://downloads.example.org/fedora-workstation.iso',
          filename: 'fedora-workstation.iso',
          destination_path: 'C:\\Downloads\\fedora-workstation.iso',
          total_bytes: 2500000000,
          downloaded_bytes: 500000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 10590617, // ~10.1 MB/s
          eta_seconds: 188,
          created_at: Date.now() + 1,
          updated_at: Date.now() + 1,
        },
        {
          id: 'dl-rate-kb',
          url: 'https://downloads.example.org/patch.diff',
          filename: 'patch.diff',
          destination_path: 'C:\\Downloads\\patch.diff',
          total_bytes: 50000000,
          downloaded_bytes: 10000000,
          status: 'downloading',
          queue_id: 'default',
          speed_bytes_sec: 461824, // ~451 KB/s
          eta_seconds: 86,
          created_at: Date.now() + 2,
          updated_at: Date.now() + 2,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // Verify first download card: 23 MB/s, strictly NO decimals (no 23.4 MB/s)
    const card1 = page.locator('div.rounded-xl', { hasText: 'ubuntu-24.04.iso' });
    await expect(card1).toBeVisible();
    const rate1 = card1.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(rate1).toBeVisible();
    const rate1Text = await rate1.innerText();
    expect(rate1Text).toContain('23 MB/s');
    expect(rate1Text).not.toContain('23.4');
    expect(rate1Text).not.toContain('.4');

    // Verify second download card: 10 MB/s, strictly NO decimals (no 10.1 MB/s)
    const card2 = page.locator('div.rounded-xl', { hasText: 'fedora-workstation.iso' });
    await expect(card2).toBeVisible();
    const rate2 = card2.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(rate2).toBeVisible();
    const rate2Text = await rate2.innerText();
    expect(rate2Text).toContain('10 MB/s');
    expect(rate2Text).not.toContain('10.1');
    expect(rate2Text).not.toContain('.1');

    // Verify third download card: 451 KB/s, whole integer KB/s
    const card3 = page.locator('div.rounded-xl', { hasText: 'patch.diff' });
    await expect(card3).toBeVisible();
    const rate3 = card3.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(rate3).toBeVisible();
    const rate3Text = await rate3.innerText();
    expect(rate3Text).toContain('451 KB/s');
    expect(rate3Text).not.toContain('.0');

    expect(errors).toEqual([]);
  });

  test('Complete Lifecycle: Paused, Queued, Completed, and Error/Failed phases UI presence', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'dl-paused',
          url: 'https://ex.com/paused-job.tar',
          filename: 'paused-job.tar',
          destination_path: 'C:\\Downloads\\paused-job.tar',
          total_bytes: 200000000,
          downloaded_bytes: 50000000,
          status: 'paused',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'dl-queued',
          url: 'https://ex.com/queued-job.tar',
          filename: 'queued-job.tar',
          destination_path: 'C:\\Downloads\\queued-job.tar',
          total_bytes: 300000000,
          downloaded_bytes: 0,
          status: 'queued',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 1,
          updated_at: Date.now() + 1,
        },
        {
          id: 'dl-completed',
          url: 'https://ex.com/done-job.zip',
          filename: 'done-job.zip',
          destination_path: 'C:\\Downloads\\done-job.zip',
          total_bytes: 100000000,
          downloaded_bytes: 100000000,
          status: 'completed',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 2,
          updated_at: Date.now() + 2,
        },
        {
          id: 'dl-failed',
          url: 'https://ex.com/failed-job.iso',
          filename: 'failed-job.iso',
          destination_path: 'C:\\Downloads\\failed-job.iso',
          total_bytes: 400000000,
          downloaded_bytes: 20000000,
          status: 'failed',
          error_message: 'Access denied: destination path is read-only',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now() + 3,
          updated_at: Date.now() + 3,
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    // 1. Paused phase UI presence
    const pausedCard = page.locator('div.rounded-xl', { hasText: 'paused-job.tar' });
    await expect(pausedCard).toBeVisible();
    await expect(pausedCard.getByText('PAUSED').first()).toBeVisible();
    const pausedRate = pausedCard.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(pausedRate).toHaveText('0 B/s (0 Mbps)');
    const pausedTimeLeft = pausedCard.locator('div:has(> span:text-is("Time left"))').locator('span').nth(1);
    await expect(pausedTimeLeft).toHaveText('Paused');

    // 2. Queued phase UI presence
    const queuedCard = page.locator('div.rounded-xl', { hasText: 'queued-job.tar' });
    await expect(queuedCard).toBeVisible();
    await expect(queuedCard.getByText('QUEUED').first()).toBeVisible();
    const queuedRate = queuedCard.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(queuedRate).toHaveText('0 B/s (0 Mbps)');
    const queuedTimeLeft = queuedCard.locator('div:has(> span:text-is("Time left"))').locator('span').nth(1);
    await expect(queuedTimeLeft).toHaveText('In Queue');

    // 3. Completed phase UI presence
    const doneCard = page.locator('div.rounded-xl', { hasText: 'done-job.zip' });
    await expect(doneCard).toBeVisible();
    await expect(doneCard.getByText('COMPLETED').first()).toBeVisible();
    const doneRate = doneCard.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(doneRate).toHaveText('0 B/s (0 Mbps)');
    const doneTimeLeft = doneCard.locator('div:has(> span:text-is("Time left"))').locator('span').nth(1);
    await expect(doneTimeLeft).toHaveText('Done');
    await expect(doneCard.locator('button:has-text("Open")')).toBeVisible();

    // 4. Error / Failed phase UI presence
    const failedCard = page.locator('div.rounded-xl', { hasText: 'failed-job.iso' });
    await expect(failedCard).toBeVisible();
    await expect(failedCard.getByText('FAILED').first()).toBeVisible();
    const failedRate = failedCard.locator('div:has(> span:text-is("Transfer rate"))').locator('span').nth(1);
    await expect(failedRate).toHaveText('0 B/s (0 Mbps)');
    const failedTimeLeft = failedCard.locator('div:has(> span:text-is("Time left"))').locator('span').nth(1);
    await expect(failedTimeLeft).toHaveText('Failed');
    // Error banner with recovery action
    await expect(failedCard.getByText('Access denied: destination path is read-only')).toBeVisible();
    await expect(failedCard.getByText('Change Location & Retry')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Accept / Reject phase: Delete Confirmation Modal lifecycle', async ({ page }) => {
    await page.evaluate(() => {
      const mockItems = [
        {
          id: 'dl-reject-accept',
          url: 'https://ex.com/delete-lifecycle-target.bin',
          filename: 'delete-lifecycle-target.bin',
          destination_path: 'C:\\Downloads\\delete-lifecycle-target.bin',
          total_bytes: 150000000,
          downloaded_bytes: 45000000,
          status: 'paused',
          queue_id: 'default',
          speed_bytes_sec: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];
      sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    });

    await page.reload();

    const targetHeading = page.getByRole('heading', { name: 'delete-lifecycle-target.bin' });
    await expect(targetHeading).toBeVisible();

    // Click Delete button
    const deleteBtn = page.getByRole('button', { name: 'Delete download...', exact: true }).first();
    await deleteBtn.click();

    // Modal appears
    const modal = page.locator('[data-testid="delete-confirm-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Delete.' })).toBeVisible();

    // REJECT deletion phase: click Cancel
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();
    await expect(targetHeading).toBeVisible(); // Item preserved

    // ACCEPT deletion phase: open modal again and confirm delete
    await deleteBtn.click();
    await expect(modal).toBeVisible();
    await modal.locator('button:has-text("Delete from Device"), button:has-text("Remove from List")').click();

    // Item successfully deleted from UI
    await expect(targetHeading).not.toBeVisible();
    await expect(page.locator('text=No downloads found')).toBeVisible();
  });
});
