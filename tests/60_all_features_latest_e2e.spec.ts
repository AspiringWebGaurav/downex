import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Comprehensive Latest Features E2E (OTA, Marquee, Ban/Unban, Speed Limiter, Complete Modal, Dev QA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=All Downloads', { timeout: 15000 });
  });

  test('1. Dev QA pure dynamic theme sync, Marquee Notice toggle, and Dev/Prod dynamic gate', async ({ page }) => {
    const pill = page.locator('[data-testid="dev-qa-pill-trigger"]');
    await expect(pill).toBeVisible();

    // Verify collapsed pill uses Light surface in Light Mode (not inverted black)
    const pillBgLight = await pill.evaluate((el) =>
      window.getComputedStyle(el.parentElement!).backgroundColor
    );
    expect(pillBgLight).toBe('rgb(255, 255, 255)');

    // Open Dev QA and verify Modals -> Marquee Notice toggle
    await pill.click();
    await expect(page.locator('text=Dev QA & Control Center')).toBeVisible();

    await page.getByRole('button', { name: 'Modals', exact: true }).click();
    const marqueeToggle = page.locator('[data-testid="dev-qa-toggle-marquee-notice"]');
    await expect(marqueeToggle).toBeVisible();
    await marqueeToggle.click();

    const headerMarquee = page.locator('.downex-marquee-group');
    await expect(headerMarquee).toBeVisible({ timeout: 5000 });
    await expect(headerMarquee).toContainText('DEV QA');

    // Clear notice via Dev QA
    await marqueeToggle.click();
    await expect(headerMarquee).toHaveCount(0);

    // Toggle Dark Theme via Dev QA header button and confirm sidebar stays synced
    await page.locator('button[title="Toggle Light / Dark mode"]').click();
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('dark'))
    ).toBe(true);
    await expect(page.locator('button[aria-label="Light mode"]')).toBeVisible();

    // Toggle back to Light Theme
    await page.locator('button[title="Toggle Light / Dark mode"]').click();
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('dark'))
    ).toBe(false);

    // Dynamic Production mode immediately disables Dev QA
    await page.evaluate(() => {
      (window as any).__DOWNEX_FORCE_PRODUCTION__ = true;
    });
    await expect(page.locator('text=Dev QA & Control Center')).toBeHidden();
    await expect(pill).toBeHidden();
  });

  test('2. Search Ctrl+K, Navigation Views, Inline Speed Limiter (50Mb-200Mb + Tab), and In-App Complete Modal', async ({ page }) => {
    // Ctrl+K focuses search and finds Gaurav Portal
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('gauravpatil.site');
    await expect(page.locator('[data-testid="search-result-owner-gauravpatil-portal"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // Navigation across latest views
    await page.getByRole('button', { name: 'Queues' }).click();
    await expect(page.locator('text=1-by-1 Queue').first()).toBeVisible();
    await page.getByRole('button', { name: 'Speed & Stats' }).click();
    await page.getByRole('button', { name: 'Speed Test' }).click();
    await expect(page.locator('text=Live Speed Test')).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.locator('[data-testid="settings-footer"]')).toBeVisible();
    await page.getByRole('button', { name: 'All Downloads' }).click();

    // Test Inline Speed Limiter presets (50Mb..200Mb incl 190Mb) + Custom + Tab restore
    await page.locator('[data-testid="dev-qa-pill-trigger"]').click();
    await page.locator('button:has-text("100 Mbps (ISO)")').click();
    await page.locator('button[title="Close panel (Ctrl+Shift+D)"]').click();

    await expect(page.locator('button:has-text("50Mb")').first()).toBeVisible();
    await expect(page.locator('button:has-text("190Mb")').first()).toBeVisible();
    await expect(page.locator('button:has-text("200Mb")').first()).toBeVisible();

    const customInput = page.locator('[data-testid="speed-limiter-input"]').first();
    await customInput.fill('192');
    await customInput.press('Enter');
    await expect(page.locator('button:has-text("Reset")').first()).toBeEnabled();
    await page.locator('button:has-text("Reset")').first().click();

    await expect(customInput).toHaveAttribute('placeholder', '192');
    await customInput.click();
    const tabRestore = page.locator('[data-testid="speed-limiter-tab-fill"]').first();
    await expect(tabRestore).toBeVisible();
    await tabRestore.click();
    await expect(customInput).toHaveValue('192');

    // Open isolated Complete Modal via Dev QA and verify Swiss window actions
    await page.locator('[data-testid="dev-qa-pill-trigger"]').click();
    await page.getByRole('button', { name: 'Modals', exact: true }).click();
    const [completePopup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('[data-testid="dev-qa-open-complete-modal"]').click(),
    ]);
    await completePopup.waitForLoadState('domcontentloaded');

    const completeCard = completePopup.getByTestId('download-complete-card');
    await expect(completeCard).toBeVisible({ timeout: 5000 });
    await expect(completeCard.getByRole('button', { name: 'Open With...' })).toBeVisible();
    await expect(completeCard.getByRole('button', { name: 'Open Folder' })).toBeVisible();
    await completePopup.close();
  });

  test('3. OTA Pipeline Stages, Check Updates Exclusivity, and Live Marquee Attest Reflection', async ({ page }) => {
    await page.route('**/api/downex/attest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          is_banned: false,
          notices: [
            {
              id: 'latest-e2e-notice',
              text: 'Live server notice synced through APP VERSION cleanly.',
              tone: 'update',
              modeLabel: 'UPDATE',
              modeColor: 'emerald',
              direction: 'rtl',
              speed: 1,
              active: true,
              createdAt: Date.now(),
              expiresAt: Date.now() + 60_000,
            },
          ],
        }),
      });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Marquee should reflect cleanly after packet sync
    const marquee = page.locator('.downex-marquee-group');
    await expect(marquee).toBeVisible({ timeout: 8000 });
    await expect(marquee).toContainText('UPDATE');
    await expect(marquee).toContainText('Live server notice synced through APP VERSION cleanly.');

    // Verify APP VERSION is unclickable while Check updates works exclusively
    const appVersionRow = page.getByTestId('sidebar-version');
    await expect(appVersionRow).toHaveClass(/cursor-default/);

    // Drive Dev QA OTA progression
    await page.locator('[data-testid="dev-qa-pill-trigger"]').click();
    await page.getByRole('button', { name: 'OTA Updates', exact: true }).click();
    await page.locator('[data-testid="dev-qa-run-full-ota"]').click();

    await expect(page.getByTestId('sidebar-version-stage')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=A new version is available')).toHaveCount(0);
  });

  test('4. Live Hardware BAN / UNBAN closes open modals, hides marquee, enforces lock, and restores exact pre-ban UI', async ({ page }) => {
    await page.route('**/api/downex/attest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          is_banned: false,
          notices: [
            {
              id: 'ban-test-notice',
              text: 'System healthy before ban directive test.',
              tone: 'info',
              modeLabel: 'NOTICE',
              modeColor: 'zinc',
              direction: 'rtl',
              speed: 1,
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
    await page.waitForFunction(() => Boolean((window as any).__DOWNEX_BAN_STORE__));

    // Confirm marquee is visible before ban
    const marquee = page.locator('.downex-marquee-group');
    await expect(marquee).toBeVisible({ timeout: 8000 });

    // Navigate to Queues and open New Download Modal (to verify BAN dismisses stray modals!)
    await page.getByRole('button', { name: 'Queues' }).click();
    await expect(page.locator('text=1-by-1 Queue').first()).toBeVisible();
    await page.keyboard.press('Control+n');
    const modalHeading = page.getByText('NEW DOWNLOAD', { exact: true });
    await expect(modalHeading).toBeVisible();

    // Enforce live BAN
    await page.evaluate(async () => {
      await (window as any).__DOWNEX_BAN_STORE__.getState().enforceBanLive('Policy violation test');
    });

    // Stray modal closed, marquee hidden, BAN screen visible, Check updates disabled
    await expect(modalHeading).toBeHidden();
    await expect(marquee).toHaveCount(0);
    await expect(page.locator('text=BAN!')).toBeVisible();
    await expect(page.locator('text=You have been banned from ADMIN')).toBeVisible();
    await expect(page.locator('text=Policy violation test')).toBeVisible();
    await expect(page.locator('button[aria-label="Updates unavailable (Device banned)"]')).toBeDisabled();

    // Lift live BAN and verify reinstatement & exact pre-ban UI restoration
    await page.evaluate(async () => {
      const store = (window as any).__DOWNEX_BAN_STORE__.getState();
      store.setReinstating(true);
      await store.liftBanLive();
      store.setReinstating(false);
    });

    await expect(page.locator('text=BAN!')).toBeHidden();
    await expect(page.locator('text=1-by-1 Queue').first()).toBeVisible({ timeout: 5000 });
    await expect(marquee).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button[aria-label="Check for updates"]')).toBeEnabled();
  });

  test('5. Window Close (X) button loads normal without red highlight on boot/focus and only highlights on deliberate hover', async ({ page }) => {
    const closeBtn = page.locator('button[aria-label="Close to System Tray"]');
    await expect(closeBtn).toBeVisible();

    // Immediately on load / focus synthetic mouseenter must not highlight X red
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Close to System Tray"]');
      window.dispatchEvent(new Event('focus'));
      btn?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    const initialBg = await closeBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(initialBg).not.toBe('rgb(232, 17, 35)');

    // After load settle window (400ms), intentional pointer hover highlights X red cleanly and leave clears it
    await page.waitForTimeout(420);
    const box = await closeBtn.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 3 });
    await expect.poll(() =>
      closeBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    ).toBe('rgb(232, 17, 35)');

    await page.mouse.move(10, 10);
    await expect.poll(() =>
      closeBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    ).not.toBe('rgb(232, 17, 35)');
  });

  test('6. APP VERSION & v0.0.1 smoothly cross-glide during UP TO DATE and return cleanly to original positions', async ({ page }) => {
    const versionRow = page.getByTestId('sidebar-version');
    const appLabel = versionRow.locator('text=APP VERSION');
    const verBadge = versionRow.locator('text=v0.0.1');

    await expect(appLabel).toHaveCSS('opacity', '1');
    const idleAppBox = await appLabel.boundingBox();
    const idleVerBox = await verBadge.boundingBox();
    expect(idleVerBox!.x).toBeGreaterThan(idleAppBox!.x);

    // Trigger manual UP TO DATE state
    await page.evaluate(() => {
      (window as any).__DOWNEX_VERSION_STORE__.setState({
        status: { state: 'up-to-date', isManualCheck: true },
      });
    });

    await page.waitForTimeout(450);
    const stageEl = page.getByTestId('sidebar-version-stage');
    await expect(stageEl).toHaveText('UP TO DATE');
    await expect(appLabel).toHaveCSS('opacity', '0');

    const activeVerBox = await verBadge.boundingBox();
    const stageBox = await stageEl.boundingBox();
    expect(activeVerBox!.x).toBeLessThan(stageBox!.x);
    expect(activeVerBox!.x + activeVerBox!.width).toBeLessThan(stageBox!.x);

    // Transition back to idle and verify smooth return to exact original coordinates
    await page.evaluate(() => {
      (window as any).__DOWNEX_VERSION_STORE__.setState({
        status: { state: 'idle', isManualCheck: false },
      });
    });

    await page.waitForTimeout(500);
    await expect(appLabel).toHaveCSS('opacity', '1');
    await expect(stageEl).toHaveCount(0);

    const restoredVerBox = await verBadge.boundingBox();
    expect(Math.abs(restoredVerBox!.x - idleVerBox!.x)).toBeLessThanOrEqual(2);
  });

  test('7. Clicking Check updates during an active silent background check promotes cleanly and never misses', async ({ page }) => {
    let releaseManifest!: () => void;
    const manifestGate = new Promise<void>((res) => {
      releaseManifest = res;
    });

    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await manifestGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ no_release: true }),
      });
    });

    // Kick off silent background check first (invisible)
    await page.evaluate(() => {
      (window as any).__DOWNEX_VERSION_STORE__.getState().checkForUpdates(true);
    });
    await page.waitForTimeout(80);

    // Click Check updates while silent check is in flight — must promote immediately instead of dropping
    const checkBtn = page.locator('button[aria-label="Check for updates"]');
    await checkBtn.click();

    await expect(checkBtn).toHaveAttribute('aria-busy', 'true');
    const stageEl = page.getByTestId('sidebar-version-stage');
    await expect(stageEl).toHaveText('CHECKING', { timeout: 3000 });

    // Release network response and verify UP TO DATE appears cleanly
    releaseManifest();
    await expect(stageEl).toHaveText('UP TO DATE', { timeout: 5000 });
  });

  test('8. Silent background checks keep APP VERSION quiet, and Start Download from Queues switches to All Downloads', async ({ page }) => {
    const versionRow = page.getByTestId('sidebar-version');
    const stageEl = page.getByTestId('sidebar-version-stage');

    // Silent background check with no newer release must NEVER change APP VERSION UI
    await page.route('**/api/v1/releases/downex/latest*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ no_release: true }),
      });
    });

    await page.evaluate(async () => {
      await (window as any).__DOWNEX_VERSION_STORE__.getState().checkForUpdates(true);
    });
    await page.waitForTimeout(300);
    await expect(versionRow.locator('text=APP VERSION')).toHaveCSS('opacity', '1');
    await expect(stageEl).toHaveCount(0);

    // Navigate to Queues first, then start an immediate download -> UI must switch to All Downloads
    await page.getByRole('button', { name: 'Queues' }).click();
    await expect(page.locator('h3', { hasText: 'Simple 1-by-1 Queue' })).toBeVisible();

    await page.click('aside button:has-text("Add URL")');
    const urlInput = page.locator('input[placeholder*="Paste download link"]');
    await urlInput.fill('https://cdn.example.org/Singh.Vs.Kaur-2.2026.mkv');
    await page.locator('button:has-text("Start Download")').click();

    await expect(page.locator('div.rounded-xl', { hasText: 'Singh.Vs.Kaur-2.2026.mkv' })).toBeVisible();
    await expect(page.locator('aside button', { hasText: 'All Downloads' })).toHaveAttribute('class', /bg-black|bg-zinc-900/);
  });

  test('9. Automatic system profile activates downex-eco-mode CSS under Low-RAM / Heavy-Load and restores Normal', async ({ page }) => {
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('downex-eco-mode'))
    ).toBe(false);

    // Trigger an active card / animated probe element so we inspect real computed CSS animation behavior
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'e2e-eco-anim-probe';
      probe.className = 'animate-shimmer';
      document.body.appendChild(probe);
    });

    const animBefore = await page.evaluate(() => {
      const el = document.getElementById('e2e-eco-anim-probe')!;
      return window.getComputedStyle(el).animationName;
    });
    expect(animBefore).not.toBe('none');

    // Simulate OS backend switching automatically to Low-RAM profile (4 GB class)
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-system-profile', {
          detail: {
            mode: 'low_ram',
            eco_ui: true,
            max_connections_cap: 8,
            max_concurrent_tasks: 1,
            telemetry_interval_ms: 350,
            ui_poll_interval_ms: 3000,
            prewarm_dialogs: false,
            destroy_dialogs_on_close: true,
            force_background_priority: true,
            total_phys_mb: 4096,
            avail_phys_mb: 1600,
            memory_load_pct: 61,
            cpu_load_pct: 12,
            is_low_ram_hardware: true,
          },
        })
      );
    });

    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('downex-eco-mode'))
    ).toBe(true);
    await expect.poll(() =>
      page.evaluate(() => (window as any).__DOWNEX_DOWNLOAD_STORE__.getState().systemProfile.ui_poll_interval_ms)
    ).toBe(3000);

    const animDuringEco = await page.evaluate(() => {
      const el = document.getElementById('e2e-eco-anim-probe')!;
      return window.getComputedStyle(el).animationName;
    });
    expect(animDuringEco).toBe('none');

    // Transition automatically to Heavy-Load profile (CPU/RAM spike)
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-system-profile', {
          detail: {
            mode: 'heavy_load',
            eco_ui: true,
            max_connections_cap: 4,
            max_concurrent_tasks: 1,
            telemetry_interval_ms: 450,
            ui_poll_interval_ms: 3500,
            prewarm_dialogs: false,
            destroy_dialogs_on_close: true,
            force_background_priority: true,
            total_phys_mb: 16384,
            avail_phys_mb: 350,
            memory_load_pct: 94,
            cpu_load_pct: 91,
            is_low_ram_hardware: false,
          },
        })
      );
    });

    await expect.poll(() =>
      page.evaluate(() => (window as any).__DOWNEX_DOWNLOAD_STORE__.getState().systemProfile.max_connections_cap)
    ).toBe(4);
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('downex-eco-mode'))
    ).toBe(true);

    // Recover automatically back to Normal profile
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('downex-system-profile', {
          detail: {
            mode: 'normal',
            eco_ui: false,
            max_connections_cap: 32,
            max_concurrent_tasks: 3,
            telemetry_interval_ms: 150,
            ui_poll_interval_ms: 1000,
            prewarm_dialogs: true,
            destroy_dialogs_on_close: false,
            force_background_priority: false,
            total_phys_mb: 16384,
            avail_phys_mb: 8192,
            memory_load_pct: 50,
            cpu_load_pct: 10,
            is_low_ram_hardware: false,
          },
        })
      );
    });

    await expect.poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('downex-eco-mode'))
    ).toBe(false);
    const animRestored = await page.evaluate(() => {
      const el = document.getElementById('e2e-eco-anim-probe')!;
      return window.getComputedStyle(el).animationName;
    });
    expect(animRestored).not.toBe('none');
  });
});
