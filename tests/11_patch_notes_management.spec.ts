import { test, expect } from '@playwright/test';
import { clearTestStorage, captureConsoleErrors } from './helpers/test-utils';

test.describe('Downex In-App Patch Notes & Release Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({ page }) => {
    await clearTestStorage(page);
  });

  test('Settings card renders and navigates to dedicated in-app Patch Notes view', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    // 1. Navigate to Settings
    await page.click('button:has-text("Settings")');
    await expect(page.getByRole('heading', { name: 'Downex Preferences & System Telemetry' })).toBeVisible();

    // 2. Check for Patch Notes card entry
    const patchNotesRow = page.locator('text=Release Changelogs & Patch Notes');
    await expect(patchNotesRow).toBeVisible();

    const viewBtn = page.locator('#view-patch-notes-btn');
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();

    // 3. Confirm in-app view opened (zero external browser)
    await expect(page.locator('h2:has-text("Release Notes & Changelogs")')).toBeVisible();
    await expect(page.locator('text=Detailed version history and feature changelogs across all published releases.')).toBeVisible();

    // 4. Back button returns to settings
    const backBtn = page.locator('button[title="Return to Settings"]');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page.getByRole('heading', { name: 'Downex Preferences & System Telemetry' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Displays comprehensive version timeline from v0.0.8 through v0.0.0 with badges and highlights', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');
    await page.click('#view-patch-notes-btn');

    // Verify key versions are present
    await expect(page.locator('text=v0.0.8').first()).toBeVisible();
    await expect(page.locator('text=v0.0.7').first()).toBeVisible();
    await expect(page.locator('text=v0.0.6').first()).toBeVisible();
    await expect(page.locator('text=v0.0.0').first()).toBeVisible();

    // Verify special badges
    await expect(page.locator('span:has-text("LIFETIME BASE ANCHOR")')).toBeVisible();

    // Verify title and bullet highlight content
    await expect(page.locator('text=Dedicated Light-Theme Restart Supervisor')).toBeVisible();
    await expect(page.locator('text=Dedicated light-theme restarting window with 7-second intentional handoff transition')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Expand and Collapse all manifest notes and individual card toggles', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');
    await page.click('#view-patch-notes-btn');

    // Click "Expand All"
    await page.click('button:has-text("Expand All")');
    await expect(page.locator('text=v0.0.7: Dedicated light-theme restarting window with 7-second handoff transition and atomic process supervisor.')).toBeVisible();

    // Click "Collapse"
    await page.click('button:has-text("Collapse")');
    await expect(page.locator('text=v0.0.7: Dedicated light-theme restarting window with 7-second handoff transition and atomic process supervisor.')).not.toBeVisible();

    // Test individual expand toggle on a card
    const manifestToggle = page.locator('button:has-text("View release manifest note")').first();
    await manifestToggle.click();
    await expect(page.locator('button:has-text("Hide release manifest")').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Filter and search changelogs by version or keyword', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');
    await page.click('#view-patch-notes-btn');

    const searchInput = page.locator('input[placeholder*="Search changelogs or versions"]');
    await searchInput.fill('0.0.7');

    // v0.0.7 should remain visible
    await expect(page.locator('text=v0.0.7').first()).toBeVisible();
    // v0.0.3 should be filtered out
    await expect(page.locator('text=v0.0.3')).not.toBeVisible();

    // Search by keyword
    await searchInput.fill('sockets');
    await expect(page.locator('text=High-Throughput Concurrent Chunk Multiplexer')).toBeVisible();

    // Clear search
    await searchInput.fill('');
    await expect(page.locator('text=v0.0.0').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('In-app authoring and persistence: Create new release note and verify persistence', async ({ page }) => {
    const errors = captureConsoleErrors(page);

    await page.click('button:has-text("Settings")');
    await page.click('#view-patch-notes-btn');

    // Click "Author Note"
    await page.click('button:has-text("Author Note")');

    // Modal appears
    await expect(page.locator('h3:has-text("Author New Patch Note")')).toBeVisible();

    // Fill in version, title, highlights
    await page.fill('input[placeholder="0.0.9"]', '0.0.10');
    await page.fill('input[placeholder="Enhanced Network Throughput & UI Improvements"]', 'Autonomous TCP Engine & Real-Time Sync');
    await page.fill('input[placeholder="Highlight #1"]', 'Next-generation adaptive socket balancing');

    // Add second bullet
    await page.click('button:has-text("Add Bullet")');
    await page.fill('input[placeholder="Highlight #2"]', 'Zero-lock in-app patch notes management');

    // Save
    await page.click('button:has-text("Save Release Note")');

    // Modal closes
    await expect(page.locator('h3:has-text("Author New Patch Note")')).not.toBeVisible();

    // Verify new note appears in the timeline with IN-APP AUTHORED badge
    await expect(page.locator('text=v0.0.10').first()).toBeVisible();
    await expect(page.locator('text=IN-APP AUTHORED')).toBeVisible();
    await expect(page.locator('text=Autonomous TCP Engine & Real-Time Sync')).toBeVisible();
    await expect(page.locator('text=Next-generation adaptive socket balancing')).toBeVisible();

    // Reload the page and navigate back to Patch Notes to verify persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.click('button:has-text("Settings")');
    await page.click('#view-patch-notes-btn');

    await expect(page.locator('text=v0.0.10').first()).toBeVisible();
    await expect(page.locator('text=Autonomous TCP Engine & Real-Time Sync')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
