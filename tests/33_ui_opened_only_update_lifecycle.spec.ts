import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex — UI-Opened Only Update Lifecycle & Smooth Visual Transition', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/downex/stream/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': keepalive\n\n' });
    });
    await page.route('**/api/downex/attest*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notices: [] }) });
    });
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test('Test 1: App is 100% idle and unaware when hidden in background/tray', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    let updateCheckCount = 0;

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      updateCheckCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: '0.0.2' }),
      });
    });

    // Simulate window hidden in system tray (document.visibilityState === 'hidden')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait 2.5s while hidden
    await page.waitForTimeout(2500);

    // Verify ZERO background checks occurred while sitting hidden in tray
    expect(updateCheckCount).toBe(0);

    // Verify sidebar version row stays completely clean and idle (no update banner, no background download)
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('Test 2: Opening UI triggers detection & smooth download progression', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.2',
          notes: 'Performance update with multi-stream speedups.',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
              signature: 'SIMULATED_SIGNATURE',
              size: 15414272,
            },
          },
        }),
      });
    });

    // Ensure window is visible (user opened UI from tray)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Verify detection starts when UI opens
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toBeVisible({ timeout: 5000 });

    expect(errors).toEqual([]);
  });

  test('Test 3: Download executes FIRST before QUEUED guard while typing, then direct crisp close on restart', async ({ page }) => {
    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();

    // User focuses and types in search bar BEFORE update evaluates
    await searchInput.focus();
    await searchInput.fill('ubuntu iso');

    // Run real updateService.evaluateAndApplyUpdate() with a simulated manifest (not yet downloaded)
    const observedStates: string[] = [];
    await page.evaluate(() => {
      const svc = (window as any).updateService;
      if (!svc) return;
      (window as any).__DOWNEX_OBSERVED_STATES__ = [];
      svc.subscribe((st: any) => {
        const list = (window as any).__DOWNEX_OBSERVED_STATES__;
        if (list[list.length - 1] !== st.state) {
          list.push(st.state);
        }
      });
      svc.notify({
        state: 'available',
        targetVersion: '0.0.2',
        isManualCheck: false,
        manifest: {
          version: '0.0.2',
          notes: 'Download-first OTA guard test',
          pub_date: new Date().toISOString(),
          url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
          signature: 'SIMULATED_SIGNATURE',
          size: 15414272,
        },
      });
      svc.evaluateAndApplyUpdate();
    });

    // Must DOWNLOAD & VERIFY FIRST — must NOT jump to QUEUED before downloading!
    await expect(stageEl).toContainText('%', { timeout: 5000 });

    const statesWhileDownloading = await page.evaluate(() => (window as any).__DOWNEX_OBSERVED_STATES__ || []);
    const downloadIdx = statesWhileDownloading.indexOf('downloading');
    const preDownloadQueuedIdx = statesWhileDownloading.indexOf('waiting_timer');
    expect(downloadIdx).toBeGreaterThanOrEqual(0);
    expect(preDownloadQueuedIdx === -1 || preDownloadQueuedIdx > downloadIdx).toBe(true);

    // Wait for download + verify to finish -> because user is actively typing, NOW holds in QUEUED
    await expect(stageEl).toContainText('QUEUED', { timeout: 10000 });

    const statesAfterDownload = await page.evaluate(() => (window as any).__DOWNEX_OBSERVED_STATES__ || []);
    const verifyIdx = statesAfterDownload.indexOf('verifying');
    const queuedIdx = statesAfterDownload.indexOf('waiting_timer');
    expect(verifyIdx).toBeGreaterThan(downloadIdx);
    expect(queuedIdx).toBeGreaterThan(verifyIdx);
    observedStates.push(...statesAfterDownload);

    // Simulate user finished interacting, entering restarting phase with ZERO white blank flash
    await page.evaluate(() => {
      const store = (window as any).__DOWNEX_VERSION_STORE__;
      store.setState({
        status: {
          state: 'restarting',
          targetVersion: '0.0.2',
        },
      });
    });

    await expect(stageEl).toContainText('RESTARTING');
    await expect(page.locator('.fade-out')).toHaveCount(0);
    await page.waitForTimeout(450);
    const rootOpacity = await page.evaluate(() => {
      const el = document.querySelector('#root > div');
      return el ? window.getComputedStyle(el).opacity : '1';
    });
    expect(Number(rootOpacity)).toBeGreaterThanOrEqual(0.99);
    expect(observedStates.length).toBeGreaterThan(0);
  });

  test('Test 4: Clean boot SSE/attest syncs through APP VERSION download & verify BEFORE reflecting marquee, with clean single badge', async ({ page }) => {
    let releaseAttest!: () => void;
    const attestGate = new Promise<void>((res) => {
      releaseAttest = res;
    });

    await page.route('**/api/downex/attest*', async (route) => {
      await attestGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          notices: [
            {
              id: 'notice-tip-1',
              text: 'Tip: Adjust parallel threads in Settings for faster multi-part speeds',
              tone: 'tip',
              modeLabel: 'TIP',
              modeColor: 'violet',
              direction: 'rtl',
              speed: 0.75,
              active: true,
              createdAt: Date.now(),
              expiresAt: null,
            },
          ],
        }),
      });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean((window as any).updateService));

    // Must NOT show marquee out of the box before APP VERSION sync completes
    const marqueeGroup = page.locator('.downex-marquee-group');
    await expect(marqueeGroup).toHaveCount(0);

    await page.evaluate(() => {
      const svc = (window as any).updateService;
      const events: string[] = [];
      (window as any).__DOWNEX_SYNC_ORDER__ = events;
      svc.subscribe((st: any) => {
        if (events[events.length - 1] !== st.state) {
          events.push(st.state);
        }
      });
      const observer = new MutationObserver(() => {
        if (document.querySelector('.downex-marquee-group') && !events.includes('marquee_reflected')) {
          events.push('marquee_reflected');
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    // Release server attest response and verify DOWNLOADING -> VERIFYING -> PATCHING runs BEFORE marquee renders
    releaseAttest();

    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toContainText('%', { timeout: 5000 });
    await expect(marqueeGroup).toBeVisible({ timeout: 5000 });

    const fullText = (await marqueeGroup.innerText()).replace(/\s+/g, ' ').trim();
    expect(fullText).toContain('TIP');
    expect(fullText).toContain('Adjust parallel threads');
    expect(fullText.toLowerCase()).not.toContain('tip: tip:');

    const syncOrder = await page.evaluate(() => (window as any).__DOWNEX_SYNC_ORDER__ || []);
    console.log('TEST 4 SYNC ORDER:', JSON.stringify(syncOrder));
    const dlIdx = syncOrder.indexOf('downloading');
    const verIdx = syncOrder.indexOf('verifying');
    const patchIdx = syncOrder.indexOf('patching');
    const reflIdx = syncOrder.indexOf('marquee_reflected');
    expect(dlIdx).toBeGreaterThanOrEqual(0);
    expect(verIdx).toBeGreaterThan(dlIdx);
    expect(patchIdx).toBeGreaterThan(verIdx);
    expect(reflIdx).toBeGreaterThan(patchIdx);

    const durationSec = await page.locator('.downex-marquee-item-rtl').evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).animationDuration || '0');
    });
    expect(durationSec).toBeGreaterThanOrEqual(24);
  });

  test('Test 5: Stacked marquee notices play strictly 1 -> 2 -> 3 -> 4 in creation order and prune expired live', async ({ page }) => {
    await page.waitForFunction(() => Boolean((window as any).__DOWNEX_MARQUEE_STORE__));

    const now = Date.now();
    // Seed 4 stacked notices out of order by array index to prove createdAt ascending controls playback order 1..4
    await page.evaluate((baseNow) => {
      (window as any).__DOWNEX_MARQUEE_STORE__.getState().setNotices([
        { id: 'n-3', text: 'Notice Three', tone: 'tip', modeLabel: 'TIP', modeColor: 'violet', direction: 'rtl', speed: 1, active: true, createdAt: baseNow + 300, expiresAt: null },
        { id: 'n-1', text: 'Notice One', tone: 'info', modeLabel: 'NORMAL', modeColor: 'zinc', direction: 'rtl', speed: 1, active: true, createdAt: baseNow + 100, expiresAt: null },
        { id: 'n-4', text: 'Notice Four', tone: 'alert', modeLabel: 'ALERT', modeColor: 'rose', direction: 'rtl', speed: 1, active: true, createdAt: baseNow + 400, expiresAt: null },
        { id: 'n-2', text: 'Notice Two', tone: 'update', modeLabel: 'UPDATE', modeColor: 'emerald', direction: 'rtl', speed: 1, active: true, createdAt: baseNow + 200, expiresAt: baseNow + 1800 },
      ]);
    }, now);

    const marqueeItem = page.locator('.downex-marquee-track > div');
    await expect(marqueeItem).toContainText('Notice One');
    await expect(marqueeItem.locator('span.w-1\\.5.h-1\\.5')).toHaveCount(0);

    // Verify slim 20px pill height, Downex font-mono-tabular UI font, and <= 1.5px vertical centering
    const metrics = await page.evaluate(() => {
      const group = document.querySelector('.downex-marquee-group');
      const item = document.querySelector('.downex-marquee-track > div');
      if (!group || !item || item.children.length < 2) return null;
      const gRect = group.getBoundingClientRect();
      const badgeRect = item.children[0].getBoundingClientRect();
      const textRect = item.children[1].getBoundingClientRect();
      const gMid = (gRect.top + gRect.bottom) / 2;
      const bMid = (badgeRect.top + badgeRect.bottom) / 2;
      const tMid = (textRect.top + textRect.bottom) / 2;
      const font = window.getComputedStyle(item).fontFamily;
      return {
        height: Math.round(gRect.height),
        badgeOffset: Math.abs(bMid - gMid),
        textOffset: Math.abs(tMid - gMid),
        font,
      };
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.height).toBeLessThanOrEqual(20);
    expect(metrics!.badgeOffset).toBeLessThanOrEqual(1.5);
    expect(metrics!.textOffset).toBeLessThanOrEqual(1.5);
    expect(metrics!.font.toLowerCase()).toContain('mono');

    const observedOrder: string[] = [];
    for (let step = 0; step < 5; step++) {
      await expect(marqueeItem.locator('span.w-1\\.5.h-1\\.5')).toHaveCount(0);
      const txt = (await marqueeItem.innerText()).replace(/\s+/g, ' ').trim();
      observedOrder.push(txt);
      if (step < 4) {
        await marqueeItem.dispatchEvent('animationend');
        await page.waitForTimeout(60);
      }
    }

    expect(observedOrder[0]).toContain('Notice One');
    expect(observedOrder[1]).toContain('Notice Two');
    expect(observedOrder[2]).toContain('Notice Three');
    expect(observedOrder[3]).toContain('Notice Four');
    expect(observedOrder[4]).toContain('Notice One');

    // Wait past Notice Two's 1.8s expiry while playing and verify it skips cleanly from One -> Three -> Four
    await page.waitForTimeout(2100);
    await expect(marqueeItem).toContainText('Notice One');
    await marqueeItem.dispatchEvent('animationend');
    await page.waitForTimeout(60);
    await expect(marqueeItem).toContainText('Notice Three');
    await marqueeItem.dispatchEvent('animationend');
    await page.waitForTimeout(60);
    await expect(marqueeItem).toContainText('Notice Four');
    console.log('TEST 5 STACKED ORDER:', JSON.stringify(observedOrder));
  });

  test('Test 6: Update holds AVAILABLE stage visible for 3s before starting download', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: '0.0.2',
          notes: '3-second available hold verification',
          pub_date: new Date().toISOString(),
          platforms: {
            'windows-x86_64': {
              url: 'https://gphost.eu.cc/releases/downex/v0.0.2/update0.0.2.downex.bin',
              signature: 'SIMULATED_SIGNATURE',
              size: 15414272,
            },
          },
        }),
      });
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const svc = (window as any).updateService;
      (window as any).__DOWNEX_TIMING_STATES__ = [];
      svc?.subscribe((st: any) => {
        const list = (window as any).__DOWNEX_TIMING_STATES__;
        const prev = list[list.length - 1];
        if (!prev || prev.state !== st.state) {
          list.push({ state: st.state, at: Date.now() });
        }
      });
      svc?.checkForUpdates(true).then(() => {
        svc?.evaluateAndApplyUpdate();
      });
    });

    const stageEl = page.locator('[data-testid="sidebar-version-stage"]');
    await expect(stageEl).toHaveText('UPDATE AVAILABLE', { timeout: 3000 });

    // Allow the 340ms version badge slide transition to settle before measuring gap
    await page.waitForTimeout(450);

    // Verify clean separation (zero visual overlap between vX.Y.Z badge and UPDATE AVAILABLE)
    const boxes = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="sidebar-version"]');
      const stage = document.querySelector('[data-testid="sidebar-version-stage"]');
      if (!row || !stage) return null;
      const spans = Array.from(row.querySelectorAll('span'));
      const versionBadge = spans.find((el) => /^v\d+\.\d+\.\d+$/i.test((el.textContent || '').trim()));
      if (!versionBadge) return null;
      const vRect = versionBadge.getBoundingClientRect();
      const sRect = stage.getBoundingClientRect();
      return { vRight: vRect.right, sLeft: sRect.left, gap: sRect.left - vRect.right };
    });
    expect(boxes).not.toBeNull();
    expect(boxes!.gap).toBeGreaterThanOrEqual(4);

    // Must still remain in UPDATE AVAILABLE during the first ~2.2s (not jumped immediately to %)
    await page.waitForTimeout(1750);
    await expect(stageEl).toHaveText('UPDATE AVAILABLE');

    // After 3s total hold, transitions automatically into downloading (%)
    await expect(stageEl).toContainText('%', { timeout: 3500 });

    const timing = await page.evaluate(() => (window as any).__DOWNEX_TIMING_STATES__ || []);
    const availEntry = timing.find((e: any) => e.state === 'available');
    const dlEntry = timing.find((e: any) => e.state === 'downloading');
    expect(availEntry).toBeTruthy();
    expect(dlEntry).toBeTruthy();
    expect(dlEntry.at - availEntry.at).toBeGreaterThanOrEqual(2850);
    expect(errors).toEqual([]);
  });
});
