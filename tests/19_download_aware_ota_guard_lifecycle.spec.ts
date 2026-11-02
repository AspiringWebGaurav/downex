import { test, expect, Page } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

async function seedMockDownloads(page: Page, items: any[]) {
  await page.evaluate((mockItems) => {
    sessionStorage.setItem('downex_mock_downloads', JSON.stringify(mockItems));
    const dlStore = (window as any).__DOWNEX_DOWNLOAD_STORE__;
    if (dlStore) {
      dlStore.setState({ items: mockItems });
    }
  }, items);
}

async function seedVersionState(page: Page, state: any) {
  await page.evaluate((s) => {
    const verStore = (window as any).__DOWNEX_VERSION_STORE__;
    if (verStore) {
      verStore.setState(s);
    }
  }, state);
}

test.describe('Downex — Download-Aware OTA Update Guard & Resilient Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean((window as any).__DOWNEX_DOWNLOAD_STORE__ && (window as any).__DOWNEX_VERSION_STORE__));
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Stage 1: Active Download suppresses update toast and displays Update Paused (BUSY)', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed active 38.3 GB download in sessionStorage & store
    await seedMockDownloads(page, [
      {
        id: 'invasion-38gb',
        url: 'https://cdn.example.org/Invasion.S01.1080p.ATVP.WEB-DL.zip',
        filename: 'Invasion.S01.1080p.ATVP.WEB-DL.zip',
        destination_path: 'C:\\Downloads\\Invasion.zip',
        total_bytes: 41125281792, // 38.3 GB
        downloaded_bytes: 16450112716, // 40%
        status: 'downloading',
        queue_id: 'default',
        speed_bytes_sec: 6815744, // 6.5 MB/s
        eta_seconds: 3624,
        created_at: Date.now() - 3600000,
        updated_at: Date.now(),
      },
    ]);

    // 2. Seed available OTA update
    await seedVersionState(page, {
      currentVersion: '0.0.26',
      formattedVersion: 'v0.0.26',
      status: {
        state: 'available',
        targetVersion: '0.99.0',
        manifest: {
          version: '0.99.0',
          notes: 'v0.99.0: Multi-socket engine performance and security updates.',
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.99.0.bin',
              signature: 'mock_signature',
              size: 8888888,
            },
          },
        },
      },
    });

    // Verify active download item rendered in table
    await expect(page.locator('h4:has-text("Invasion")').first()).toBeVisible({ timeout: 5000 });

    // Verify floating toast is COMPLETELY SUPPRESSED while download is active
    const toastHeading = page.locator('h4:has-text("Update Available")');
    await expect(toastHeading).toHaveCount(0);

    // Verify sidebar shows protected "Update Paused" button with "BUSY" indicator
    const pausedBtn = page.locator('button:has-text("Update Paused")');
    await expect(pausedBtn).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('BUSY').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 2: Modal displays active download warning and disables update actions', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed active download
    await seedMockDownloads(page, [
      {
        id: 'invasion-38gb',
        url: 'https://cdn.example.org/Invasion.S01.zip',
        filename: 'Invasion.S01.1080p.ATVP.WEB-DL.zip',
        destination_path: 'C:\\Downloads\\Invasion.zip',
        total_bytes: 40000000000,
        downloaded_bytes: 16000000000,
        status: 'downloading',
        queue_id: 'default',
        speed_bytes_sec: 6500000,
        eta_seconds: 3600,
        created_at: Date.now() - 3600000,
        updated_at: Date.now(),
      },
    ]);

    // 2. Seed available update and open modal
    await seedVersionState(page, {
      currentVersion: '0.0.26',
      formattedVersion: 'v0.0.26',
      isModalOpen: true,
      status: {
        state: 'available',
        targetVersion: '0.99.0',
        manifest: {
          version: '0.99.0',
          notes: 'v0.99.0: Multi-socket engine performance and security updates.',
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.99.0.bin',
              signature: 'mock_signature',
              size: 8888888,
            },
          },
        },
      },
    });

    // Verify modal is open
    await expect(page.locator('text=Software Update').first()).toBeVisible({ timeout: 5000 });

    // Verify prominent protective warning banner is visible
    await expect(page.getByText('Download in Progress (1 active)')).toBeVisible();
    await expect(page.getByText('Update Blocked').first()).toBeVisible();
    await expect(page.getByText('Restarting now will interrupt active network streams')).toBeVisible();

    // Verify update button is disabled and relabeled
    const blockedBtn = page.locator('button:has-text("Blocked (Download Running)")');
    await expect(blockedBtn).toBeVisible();
    await expect(blockedBtn).toBeDisabled();

    // Verify close/later button works
    await page.click('button:has-text("Later")');
    await expect(page.locator('text=Software Update')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 3: Multi-task concurrency — Completing 1 of 2 downloads keeps update blocked', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    const initialTasks = [
      {
        id: 'dl-1-large',
        url: 'https://cdn.example.org/Invasion.zip',
        filename: 'Invasion.zip',
        destination_path: 'C:\\Downloads\\Invasion.zip',
        total_bytes: 40000000000,
        downloaded_bytes: 16000000000,
        status: 'downloading',
        queue_id: 'default',
        speed_bytes_sec: 5000000,
        created_at: Date.now() - 10000,
        updated_at: Date.now(),
      },
      {
        id: 'dl-2-patch',
        url: 'https://cdn.example.org/patch.zip',
        filename: 'patch.zip',
        destination_path: 'C:\\Downloads\\patch.zip',
        total_bytes: 50000000,
        downloaded_bytes: 45000000,
        status: 'downloading',
        queue_id: 'default',
        speed_bytes_sec: 1500000,
        created_at: Date.now() - 5000,
        updated_at: Date.now(),
      },
    ];

    await seedMockDownloads(page, initialTasks);

    await seedVersionState(page, {
      currentVersion: '0.0.26',
      formattedVersion: 'v0.0.26',
      status: {
        state: 'available',
        targetVersion: '0.99.0',
        manifest: {
          version: '0.99.0',
          notes: 'Update notes',
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.99.0.bin',
              signature: 'sig',
              size: 8888888,
            },
          },
        },
      },
    });

    // Verify sidebar shows Update Paused
    await expect(page.locator('button:has-text("Update Paused")')).toBeVisible({ timeout: 5000 });

    // Complete task 2 (patch.zip), but task 1 (Invasion.zip) is still downloading!
    const updatedTasks = [
      initialTasks[0], // Invasion.zip still downloading
      { ...initialTasks[1], status: 'completed', downloaded_bytes: initialTasks[1].total_bytes },
    ];
    await seedMockDownloads(page, updatedTasks);

    // 1 item still downloading -> Update must REMAIN BLOCKED!
    await expect(page.locator('button:has-text("Update Paused")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('h4:has-text("Update Available")')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('Stage 4: Complete transition — Finishing all downloads dynamically unblocks update', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    const activeItem = {
      id: 'dl-final',
      url: 'https://cdn.example.org/movie.mp4',
      filename: 'movie.mp4',
      destination_path: 'C:\\Downloads\\movie.mp4',
      total_bytes: 100000000,
      downloaded_bytes: 99000000,
      status: 'downloading',
      queue_id: 'default',
      speed_bytes_sec: 1000000,
      created_at: Date.now() - 5000,
      updated_at: Date.now(),
    };

    await seedMockDownloads(page, [activeItem]);

    await seedVersionState(page, {
      currentVersion: '0.0.26',
      formattedVersion: 'v0.0.26',
      status: {
        state: 'available',
        targetVersion: '0.99.0',
        manifest: {
          version: '0.99.0',
          notes: 'Update notes',
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.99.0.bin',
              signature: 'sig',
              size: 8888888,
            },
          },
        },
      },
    });

    await expect(page.locator('button:has-text("Update Paused")')).toBeVisible({ timeout: 5000 });

    // Complete the download and notify store
    const completedItem = { ...activeItem, status: 'completed', downloaded_bytes: activeItem.total_bytes };
    await seedMockDownloads(page, [completedItem]);

    // Also call onDownloadsCompleted on the version store
    await page.evaluate(() => {
      const verStore = (window as any).__DOWNEX_VERSION_STORE__;
      if (verStore && verStore.getState().onDownloadsCompleted) {
        verStore.getState().onDownloadsCompleted();
      }
    });

    // Now zero active downloads -> Update UNBLOCKS!
    // Floating toast appears automatically
    await expect(page.locator('h4:has-text("Update Available")')).toBeVisible({ timeout: 5000 });

    // Sidebar shows ready update badge
    const updateBtn = page.locator('button[title*="Update Available"]');
    await expect(updateBtn).toBeVisible({ timeout: 5000 });

    // Click to open modal
    await updateBtn.click();

    // Verify warning banner is GONE and Download/Install button is UNLOCKED
    await expect(page.getByText('Download in Progress')).toHaveCount(0);
    const installBtn = page.locator('button:has-text("Download & Install Now")');
    await expect(installBtn).toBeVisible();
    await expect(installBtn).toBeEnabled();

    expect(errors).toEqual([]);
  });

  test('Stage 5: Resilient Error Handling — Download failures and errors handled gracefully', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Inject active download and error update status
    await seedMockDownloads(page, [
      {
        id: 'dl-error-test',
        url: 'https://cdn.example.org/data.zip',
        filename: 'data.zip',
        destination_path: 'C:\\Downloads\\data.zip',
        total_bytes: 50000000,
        downloaded_bytes: 25000000,
        status: 'downloading',
        queue_id: 'default',
        speed_bytes_sec: 1000000,
        created_at: Date.now() - 5000,
        updated_at: Date.now(),
      },
    ]);

    await seedVersionState(page, {
      currentVersion: '0.0.26',
      formattedVersion: 'v0.0.26',
      status: {
        state: 'error',
        errorMessage: 'Network timeout connecting to update server',
      },
    });

    // Download continues unaffected in UI
    await expect(page.locator('h4:has-text("data.zip")').first()).toBeVisible({ timeout: 5000 });

    // No intrusive toast crashes the screen
    await expect(page.locator('h4:has-text("Update Available")')).toHaveCount(0);

    // Simulate task error (e.g. peer connection reset)
    await seedMockDownloads(page, [
      {
        id: 'dl-error-test',
        url: 'https://cdn.example.org/data.zip',
        filename: 'data.zip',
        destination_path: 'C:\\Downloads\\data.zip',
        total_bytes: 50000000,
        downloaded_bytes: 25000000,
        status: 'failed',
        error_message: 'Connection reset by peer',
        queue_id: 'default',
        speed_bytes_sec: 0,
        created_at: Date.now() - 5000,
        updated_at: Date.now(),
      },
    ]);

    // Verify item renders error/failed state without white screen or crashing
    await expect(page.locator('h4:has-text("data.zip")').first()).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });
});
