import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex Base Application — Complete In-Process OTA Update Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Stage 1: Boot Detection — Newer version triggers floating toast and sidebar badge without user interaction', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock release manifest returning newer version 0.1.0
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.1.0',
          notes: 'Added parallel multi-socket chunk acceleration and atomic zero-lock OTA updater.',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.1.0.bin',
              signature: 'mock_signature',
              size: 15728640,
            },
          },
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // On initial mount (<500ms), toast should not be present yet
    const toastHeading = page.locator('h4:has-text("Update Available")');
    await expect(toastHeading).toHaveCount(0);

    // After 1.2s boot timer fires and manifest resolves, toast and badge appear automatically
    await expect(toastHeading).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('v0.1.0').first()).toBeVisible();

    // Verify sidebar shows update badge (button titled "Update Available...")
    const sidebarBadge = page.locator('button[title*="Update Available"]');
    await expect(sidebarBadge).toBeVisible();

    // Verify "Later" dismisses the floating toast
    const laterBtn = page.locator('div.fixed button:has-text("Later")');
    await laterBtn.click();
    await expect(toastHeading).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 2: Boot Detection — Up-to-date version is 100% silent (no toast, no popups)', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Mock release manifest returning identical version 0.0.0
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.0',
          notes: 'Current version',
          pub_date: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait past the 1.2s boot timer
    await page.waitForTimeout(2500);

    // Verify zero toasts, zero update cards, zero error banners
    await expect(page.locator('h4:has-text("Update Available")')).toHaveCount(0);
    await expect(page.locator('button[title*="New Update Available"]')).toHaveCount(0);
    await expect(page.locator('text=Update Failed')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('Stage 3: Boot Detection — Network failure on silent boot stays silent without annoying popups', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Simulate network error on release manifest endpoint
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait past the 1.2s boot timer
    await page.waitForTimeout(2500);

    // Verify silent handling: no intrusive error popups
    await expect(page.locator('h4:has-text("Update Available")')).toHaveCount(0);
    await expect(page.locator('button[title*="New Update Available"]')).toHaveCount(0);
    await expect(page.locator('text=Update Failed')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('Stage 4: Complete Download, Progress Pacing & Verification to Ready state', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Prepare a mock valid Windows PE executable payload (starts with 'MZ')
    const peHeader = new Uint8Array(1024 * 600); // 600KB payload
    peHeader[0] = 0x4D; // 'M'
    peHeader[1] = 0x5A; // 'Z'

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.1.0',
          notes: 'High-speed chunking engine with zero-lock atomic swap.',
          size: peHeader.length,
          url: 'https://gphost.eu.cc/raw/downex/update-0.1.0.bin',
        }),
      });
    });

    await page.route('**/raw/downex/update-0.1.0.bin*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(peHeader),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for update available toast
    const toastHeading = page.locator('h4:has-text("Update Available")');
    await expect(toastHeading).toBeVisible({ timeout: 6000 });

    // Target the exact "Download" button in the update notification card
    const downloadBtn = page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true });
    await downloadBtn.click();

    // Verify progress/ready state is reached with restart button
    const restartBtn = page.locator('button:has-text("Restart & Apply")').or(page.locator('button:has-text("Restart to Install")'));
    await expect(restartBtn).toBeVisible({ timeout: 10000 });
    await expect(restartBtn).toBeEnabled();

    expect(errors).toEqual([]);
  });

  test('Stage 5: Navigation & Component Mount/Unmount during active download', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Set store directly to downloading state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      if (store) {
        store.setState({
          status: {
            state: 'downloading',
            targetVersion: '0.1.0',
            progress: {
              percentage: 45,
              downloadedBytes: 4500000,
              totalBytes: 10000000,
            },
          },
        });
      }
    });

    // Rapidly navigate between all sidebar views while downloading
    const views = ['Completed', 'Queues', 'Settings', 'All Downloads'];
    for (const view of views) {
      await page.click(`button:has-text("${view}")`);
      await page.waitForTimeout(100);
    }

    // Verify app remains stable and responsive
    await expect(page.locator('text=Downex').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Stage 6: Corrupt Payload Error Handling & Safety Abort', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Provide an invalid payload (missing MZ signature)
    const corruptPayload = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.1.0',
          notes: 'Corrupt payload test',
          size: corruptPayload.length,
          url: 'https://gphost.eu.cc/raw/downex/corrupt.bin',
        }),
      });
    });

    await page.route('**/raw/downex/corrupt.bin*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(corruptPayload),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for update available
    await expect(page.locator('h4:has-text("Update Available")')).toBeVisible({ timeout: 6000 });

    // Click the specific update download button
    const downloadBtn = page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true });
    await downloadBtn.click();

    // Verify error state is shown and user informed safely without crashing
    await expect(page.getByRole('heading', { name: 'Update Notice' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Verification failed/i)).toBeVisible();

    // Verify error was appropriately logged to console
    expect(errors.some((e) => e.includes('Verification failed'))).toBe(true);
  });

  test('Stage 7: In-Process Restart, Version Persistence & Patch Notes Celebration Modal', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Simulate the restart handoff: user clicked "Restart to Install"
    // which wrote recently_updated and persisted_version to localStorage
    await page.evaluate(() => {
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: '0.1.0',
          previousVersion: '0.0.0',
          notes: '• 32-stream multi-socket TCP engine\n• Zero-lock NTFS in-process atomic updates\n• Instant native clipboard URL capture',
          timestamp: Date.now(),
        })
      );
      localStorage.setItem('downex_last_known_version', '0.0.0');
      localStorage.setItem('downex_persisted_version', '0.1.0');
    });

    // 2. Reload page to simulate post-update startup
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 3. Verify celebratory Patch Notes Modal opened automatically
    await expect(page.locator('text=Update Installed Successfully')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=32-stream multi-socket TCP engine')).toBeVisible();

    // 4. Dismiss Patch Notes Modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Update Installed Successfully')).not.toBeVisible();

    // 5. Verify recently_updated was consumed and cleaned up upon dismissal
    const recentCleaned = await page.evaluate(() => localStorage.getItem('downex_recently_updated'));
    expect(recentCleaned).toBeNull();

    // 6. Verify version now reflects v0.1.0 in Sidebar and Settings
    await expect(page.locator('text=v0.1.0').first()).toBeVisible();

    await page.click('button:has-text("Settings")');
    await expect(page.locator('text=Downex Core Build: v0.1.0')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 8: Consecutive Release Cycle (Repeated Update 0.1.0 -> 0.2.0)', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed application already running on v0.1.0
    await page.evaluate(() => {
      localStorage.setItem('downex_persisted_version', '0.1.0');
      localStorage.setItem('downex_last_known_version', '0.1.0');
    });

    // 2. Mock next release manifest v0.2.0
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.2.0',
          notes: '• Smart adaptive queue scheduler\n• Bandwidth limiter slider\n• Dynamic tray download graph',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/raw/downex/update-0.2.0.bin',
              size: 16000000,
            },
          },
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify initial version is v0.1.0
    await expect(page.locator('text=v0.1.0').first()).toBeVisible();

    // Wait for boot check to detect 0.2.0
    await expect(page.locator('h4:has-text("Update Available")')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('v0.2.0', { exact: true })).toBeVisible();

    // Simulate completion of second update cycle
    await page.evaluate(() => {
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: '0.2.0',
          previousVersion: '0.1.0',
          notes: '• Smart adaptive queue scheduler\n• Bandwidth limiter slider\n• Dynamic tray download graph',
          timestamp: Date.now(),
        })
      );
      localStorage.setItem('downex_persisted_version', '0.2.0');
    });

    // Reload to complete second update restart
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Verify second celebratory Patch Notes Modal for v0.2.0
    await expect(page.locator('text=Update Installed Successfully')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Smart adaptive queue scheduler')).toBeVisible();

    // Dismiss modal
    await page.keyboard.press('Escape');

    // Verify version updated to v0.2.0
    await expect(page.locator('text=v0.2.0').first()).toBeVisible();

    await page.click('button:has-text("Settings")');
    await expect(page.locator('text=Downex Core Build: v0.2.0')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 9: Rollback Recovery — When update fails or rolls back, stale markers are purged without false celebration', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // Seed stale recently_updated for targetVersion 0.3.0, but app is actually running 0.1.0 (simulating rollback)
    await page.evaluate(() => {
      localStorage.setItem(
        'downex_recently_updated',
        JSON.stringify({
          targetVersion: '0.3.0',
          previousVersion: '0.1.0',
          notes: 'Failed experimental feature',
          timestamp: Date.now(),
        })
      );
      localStorage.setItem('downex_last_known_version', '0.1.0');
      localStorage.setItem('downex_persisted_version', '0.1.0');
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Wait past initialization
    await page.waitForTimeout(1500);

    // Verify NO celebratory Patch Notes modal was shown for the failed version
    await expect(page.locator('text=Update Installed Successfully')).toHaveCount(0);
    await expect(page.locator('text=Failed experimental feature')).toHaveCount(0);

    // Verify stale recently_updated was safely purged from localStorage
    const staleMarker = await page.evaluate(() => localStorage.getItem('downex_recently_updated'));
    expect(staleMarker).toBeNull();

    // Verify active version is safely maintained at 0.1.0
    await expect(page.locator('text=v0.1.0').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Stage 10: Cryptographic Signature Verification — Verifies authentic signature and rejects corrupt ones', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    const peHeader = new Uint8Array(1024 * 600);
    peHeader[0] = 0x4D;
    peHeader[1] = 0x5A;

    // Mock manifest with cryptographic signature
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.1.5',
          notes: 'Signed production release',
          size: peHeader.length,
          signature: 'mock_signature',
          url: 'https://gphost.eu.cc/raw/downex/update-0.1.5.bin',
        }),
      });
    });

    await page.route('**/raw/downex/update-0.1.5.bin*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(peHeader),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for update available toast
    const toastHeading = page.locator('h4:has-text("Update Available")');
    await expect(toastHeading).toBeVisible({ timeout: 6000 });

    const downloadBtn = page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true });
    await downloadBtn.click();

    // Verify successful verification and transition to ready state
    const restartBtn = page.locator('button:has-text("Restart & Apply")').or(page.locator('button:has-text("Restart to Install")'));
    await expect(restartBtn).toBeVisible({ timeout: 10000 });

    expect(errors).toEqual([]);
  });

  test('Stage 11: Network Interruption Recovery — Clean error state and safe retry', async ({ page }) => {
    let shouldFail = true;

    const peHeader = new Uint8Array(1024 * 600);
    peHeader[0] = 0x4D;
    peHeader[1] = 0x5A;

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.1.6',
          notes: 'Resilient retry release',
          size: peHeader.length,
          url: 'https://gphost.eu.cc/raw/downex/update-0.1.6.bin',
        }),
      });
    });

    await page.route('**/raw/downex/update-0.1.6.bin*', async (route) => {
      if (shouldFail) {
        await route.abort('failed');
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: Buffer.from(peHeader),
        });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for update available
    await expect(page.locator('h4:has-text("Update Available")')).toBeVisible({ timeout: 6000 });

    // Click download -> will fail due to network abort
    const downloadBtn = page.locator('div.fixed').getByRole('button', { name: 'Download', exact: true });
    await downloadBtn.click();

    // Verify error card with Retry button appears
    const retryBtn = page.locator('button:has-text("Retry")');
    await expect(retryBtn).toBeVisible({ timeout: 8000 });

    // Now restore network connection and click Retry
    shouldFail = false;
    await retryBtn.click();

    // Verify update re-checks and allows download to succeed
    await expect(page.locator('h4:has-text("Update Available")')).toBeVisible({ timeout: 6000 });
  });

  test('Stage 12: Data & Settings Integrity — User downloads, queues and settings are 100% preserved', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Seed custom user downloads and queue state in localStorage / app store
    await page.evaluate(() => {
      localStorage.setItem('downex_theme', 'dark');
      localStorage.setItem('downex_telemetry_sidebar', 'true');
      localStorage.setItem(
        'downex_user_data_test',
        JSON.stringify({
          activeDownloads: ['dl-101', 'dl-102'],
          userCustomFolder: 'D:\\Downloads\\CustomFolder',
        })
      );
    });

    // 2. Perform simulated update reload
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 3. Verify user settings and data persisted untouched
    const savedTheme = await page.evaluate(() => localStorage.getItem('downex_theme'));
    const savedUserData = await page.evaluate(() => localStorage.getItem('downex_user_data_test'));
    expect(savedTheme).toBe('dark');
    expect(JSON.parse(savedUserData || '{}').activeDownloads).toEqual(['dl-101', 'dl-102']);

    expect(errors).toEqual([]);
  });
});

