import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const screenshotDir = 'C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73/screenshots';

test.describe('Downex — Settings UI Typography and Geometry Verification (780x540)', () => {
  test.use({
    viewport: { width: 780, height: 540 },
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Verify Decluttered Settings Menu and Symmetric Spacing Above and Below Terms / Privacy Policy', async ({ page }) => {
    test.setTimeout(25000);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Settings
    const settingsBtn = page.locator('button:has-text("Settings")');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify settings header and first section
    await expect(page.getByText('PREFERENCES', { exact: true })).toBeVisible();
    await expect(page.locator('h1:has-text("Settings.")')).toBeVisible();
    await expect(page.locator('text=Start with Windows')).toBeVisible();

    // Verify decluttering: Image 3 "Exit Downex completely" and duplicate "VIEW STATS" are removed
    await expect(page.locator('text=Exit Downex completely')).toHaveCount(0);
    await expect(page.locator('button:has-text("EXIT APP")')).toHaveCount(0);
    await expect(page.locator('button:has-text("VIEW STATS")')).toHaveCount(0);

    // Verify remaining meaningful, functional settings rows
    await expect(page.locator('text=Start with Windows')).toBeVisible();
    await expect(page.locator('text=Keep running in system tray on close')).toBeVisible();
    await expect(page.locator('text=Clipboard link auto-detection')).toBeVisible();
    await expect(page.locator('text=Show speed panel on home page')).toBeVisible();
    await expect(page.locator('text=Download acceleration')).toBeVisible();
    await expect(page.locator('text=Default download folder')).toBeVisible();
    await expect(page.locator('text=Browser companion extension')).toBeVisible();
    await expect(page.locator('text=Repair app & clean cache')).toBeVisible();
    await expect(page.locator('text=Revert to Base Version (v0.0.1)')).toBeVisible();
    await expect(page.locator('text=Uninstall Downex')).toBeVisible();
    await expect(page.locator('text=Reset all preferences')).toBeVisible();

    await page.waitForTimeout(400);

    // 1. Capture Top portion in Light Mode
    const lightTop = path.join(screenshotDir, 'settings_light_top.png');
    await page.screenshot({ path: lightTop });

    // Scroll container to bottom
    const scrollContainer = page.locator('div.overflow-y-auto').first();
    await scrollContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);

    // Measure exact distance from divider line to Terms text (space above), Terms text to app UI bottom edge (space below), and horizontal centering
    const measurements = await page.evaluate(() => {
      const footer = document.querySelector('[data-testid="settings-footer"]') as HTMLElement | null;
      const container = footer?.closest('.overflow-y-auto') as HTMLElement | null;
      const buttons = footer?.querySelectorAll('button');
      const termsBtn = buttons?.[0] as HTMLElement | null;
      const privacyBtn = buttons?.[1] as HTMLElement | null;
      if (!footer || !container || !termsBtn) return null;
      container.scrollTop = container.scrollHeight;
      const footerRect = footer.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const termsRect = termsBtn.getBoundingClientRect();
      const privacyRect = privacyBtn?.getBoundingClientRect();
      const spaceAbove = Math.round(termsRect.top - footerRect.top);
      const spaceBelow = Math.round(containerRect.bottom - termsRect.bottom);
      const footerPaddingTop = window.getComputedStyle(footer).paddingTop;
      const footerPaddingBottom = window.getComputedStyle(footer).paddingBottom;

      const footerCenter = footerRect.left + footerRect.width / 2;
      const textGroupRight = privacyRect ? privacyRect.right : termsRect.right;
      const textGroupCenter = (termsRect.left + textGroupRight) / 2;
      const horizontalCenterDiff = Math.abs(Math.round(footerCenter - textGroupCenter));

      return { spaceAbove, spaceBelow, footerPaddingTop, footerPaddingBottom, horizontalCenterDiff };
    });

    console.log('Light mode measurements:', JSON.stringify(measurements));
    expect(measurements).not.toBeNull();
    // Verify exact symmetric spacing above and below Terms / Privacy Policy
    expect(measurements!.spaceAbove).toBe(measurements!.spaceBelow);
    // Verify horizontally centered (within 2px)
    expect(measurements!.horizontalCenterDiff).toBeLessThanOrEqual(2);

    // 2. Capture Bottom portion in Light Mode showing symmetric gap
    const lightBottom = path.join(screenshotDir, 'settings_light_bottom.png');
    await page.screenshot({ path: lightBottom });

    // 3. Switch to Dark Mode
    const darkToggle = page.locator('text=Dark mode').or(page.locator('text=Light mode'));
    if (await darkToggle.isVisible()) {
      await darkToggle.click();
      await page.waitForTimeout(400);

      // Verify bottom space and centering in Dark Mode as well
      const darkMeasurements = await page.evaluate(() => {
        const footer = document.querySelector('[data-testid="settings-footer"]') as HTMLElement | null;
        const container = footer?.closest('.overflow-y-auto') as HTMLElement | null;
        const buttons = footer?.querySelectorAll('button');
        const termsBtn = buttons?.[0] as HTMLElement | null;
        const privacyBtn = buttons?.[1] as HTMLElement | null;
        if (!footer || !container || !termsBtn) return null;
        container.scrollTop = container.scrollHeight;
        const footerRect = footer.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const termsRect = termsBtn.getBoundingClientRect();
        const privacyRect = privacyBtn?.getBoundingClientRect();
        const spaceAbove = Math.round(termsRect.top - footerRect.top);
        const spaceBelow = Math.round(containerRect.bottom - termsRect.bottom);

        const footerCenter = footerRect.left + footerRect.width / 2;
        const textGroupRight = privacyRect ? privacyRect.right : termsRect.right;
        const textGroupCenter = (termsRect.left + textGroupRight) / 2;
        const horizontalCenterDiff = Math.abs(Math.round(footerCenter - textGroupCenter));

        return { spaceAbove, spaceBelow, horizontalCenterDiff };
      });
      console.log('Dark mode measurements:', JSON.stringify(darkMeasurements));
      expect(darkMeasurements).not.toBeNull();
      expect(darkMeasurements!.spaceAbove).toBe(darkMeasurements!.spaceBelow);
      expect(darkMeasurements!.horizontalCenterDiff).toBeLessThanOrEqual(2);

      // Bottom portion in Dark Mode
      const darkBottom = path.join(screenshotDir, 'settings_dark_bottom.png');
      await page.screenshot({ path: darkBottom });

      // Scroll back to top
      await scrollContainer.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(400);

      // Top portion in Dark Mode
      const darkTop = path.join(screenshotDir, 'settings_dark_top.png');
      await page.screenshot({ path: darkTop });

      // Switch back to Light Mode
      await darkToggle.click();
      await page.waitForTimeout(300);
    }
  });
});
