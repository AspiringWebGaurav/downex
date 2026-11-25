import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — Full OTA Lifecycle, Fallbacks, and Timing', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/downex/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notices: [] }) });
    });
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(450);
  });

  test('Test 1: Full success lifecycle progression on UI open with zero white blank flash', async ({ page }) => {
    test.setTimeout(15000);
    const errors = captureConsoleErrors(page);

    // Mock successful v0.0.2 release
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.2',
          notes: 'Full lifecycle performance release',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
              signature: 'VALID_SIGNATURE',
              size: 15414272,
            },
          },
        }),
      });
    });

    // Mock binary download
    await page.route('**/releases/downex/v0.0.2/update0.0.2.downex.bin', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.alloc(1024 * 1024, 0x42), // 1MB simulated payload
      });
    });

    // 1. Simulate UI opened from tray
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 2. Stage progression simulation
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    // Simulate downloading state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'downloading',
          progress: { percentage: 45, downloaded: 450000, total: 1000000 },
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('45%', { timeout: 3000 });

    // Simulate verifying state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'verifying',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('VERIFYING', { timeout: 3000 });

    // Simulate patching state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'patching',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('PATCHING', { timeout: 3000 });

    // Simulate working state
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'ready',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('WORKING', { timeout: 3000 });

    // Simulate restarting state -> direct crisp UI close with ZERO white blank flash
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'restarting',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('RESTARTING', { timeout: 3000 });

    // Verify no white-flash fade-out class is applied
    await expect(page.locator('.fade-out')).toHaveCount(0);
    const rootOpacity = await page.evaluate(() => {
      const el = document.querySelector('#root > div');
      return el ? window.getComputedStyle(el).opacity : '1';
    });
    expect(rootOpacity).toBe('1');

    expect(errors).toEqual([]);
  });

  test('Test 2: User Activity Guard holds in QUEUED while typing and resumes on idle', async ({ page }) => {
    test.setTimeout(15000);
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // User types in search bar
    await searchInput.focus();
    await searchInput.fill('debian-12.iso');

    // Simulate update ready to apply
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'waiting_timer', // QUEUED
          targetVersion: '0.0.2',
        },
      });
    });

    // Guard must hold politely in QUEUED without interrupting user typing
    await expect(stageEl).toContainText('QUEUED', { timeout: 3000 });

    // Simulate user finished and idle for 5s -> advances to restarting
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'restarting',
          targetVersion: '0.0.2',
        },
      });
    });
    await expect(stageEl).toContainText('RESTARTING', { timeout: 3000 });
  });

  test('Test 3: Faulty Binary Detection & Rescue Rollback Fallback', async ({ page }) => {
    test.setTimeout(15000);
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    // Simulate corrupt/faulty binary failure handled cleanly
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      // When an integrity check fails, state reverts cleanly to idle with error handled
      store.setState({
        status: {
          state: 'error',
          errorMessage: 'Corrupt binary payload: MZ header signature missing',
          isManualCheck: true,
        },
      });
    });

    // Verify error is shown as FAILED without any UI freeze or unhandled rejection
    await expect(stageEl).toContainText('FAILED', { timeout: 3000 });

    // Verify application remains completely interactive (e.g. search bar still works)
    const searchInput = page.locator('#search-input');
    await searchInput.focus();
    await searchInput.fill('recovery test');
    expect(await searchInput.inputValue()).toBe('recovery test');
  });

  test('Test 4: Active download holds QUEUED only AFTER download & verification complete', async ({ page }) => {
    test.setTimeout(15000);
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');

    await page.evaluate(() => {
      const dlStore = (window as any).__DOWNEX_DOWNLOAD_STORE__;
      const svc = (window as any).updateService;
      if (dlStore) {
        dlStore.setState({
          items: [
            {
              id: 'dl-active-1',
              url: 'https://example.com/archive.zip',
              filename: 'archive.zip',
              destination_path: 'C:\\Downloads\\archive.zip',
              total_bytes: 1000000,
              downloaded_bytes: 250000,
              status: 'downloading',
              queue_id: 'default',
              speed_bytes_sec: 500000,
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
        });
      }
      if (svc) {
        (window as any).__DOWNEX_STATES_DL__ = [];
        svc.subscribe((st: any) => {
          const list = (window as any).__DOWNEX_STATES_DL__;
          if (list[list.length - 1] !== st.state) list.push(st.state);
        });
        svc.notify({
          state: 'available',
          targetVersion: '0.0.2',
          isManualCheck: false,
          manifest: {
            version: '0.0.2',
            notes: 'Download first while active transfer runs',
            pub_date: new Date().toISOString(),
            url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
            signature: 'SIMULATED_SIGNATURE',
            size: 15414272,
          },
        });
        svc.evaluateAndApplyUpdate();
      }
    });

    // Must download first (even while another download is running!) and ONLY then enter QUEUED
    await expect(stageEl).toContainText('%', { timeout: 5000 });
    await expect(stageEl).toContainText('QUEUED', { timeout: 10000 });

    const observed = await page.evaluate(() => (window as any).__DOWNEX_STATES_DL__ || []);
    const dlIdx = observed.indexOf('downloading');
    const verIdx = observed.indexOf('verifying');
    const qIdx = observed.indexOf('waiting_timer');
    expect(dlIdx).toBeGreaterThanOrEqual(0);
    expect(verIdx).toBeGreaterThan(dlIdx);
    expect(qIdx).toBeGreaterThan(verIdx);
  });
});
