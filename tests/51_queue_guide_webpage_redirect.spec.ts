import { test, expect } from '@playwright/test';

test.describe('Downex — How Queues Work Webpage Redirection & Zero Modal', () => {
  test('clicking "How Queues Work ->" opens the web guide and DOES NOT open in-app modal', async ({ page }) => {
    // Intercept window.open
    await page.addInitScript(() => {
      (window as any).__lastOpenedUrls = [];
      window.open = (url: any) => {
        (window as any).__lastOpenedUrls.push(String(url));
        return null;
      };
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Switch to Queues view
    const queuesNav = page.locator('button', { hasText: 'Queues' });
    await queuesNav.click();
    await page.waitForTimeout(300);

    // 1. Locate the "How Queues Work ->" button
    const howQueuesWorkBtn = page.locator('button', { hasText: 'How Queues Work' });
    await expect(howQueuesWorkBtn).toBeVisible();

    // 2. Click it
    await howQueuesWorkBtn.click();
    await page.waitForTimeout(300);

    // 3. Verify window.open was called with the exact official URL
    const openedUrls = await page.evaluate(() => (window as any).__lastOpenedUrls);
    expect(openedUrls).toContain('https://downex.apps.gauravpatil.site/how-queues-work');

    // 4. Verify NO in-app modal opened
    const modalHeading = page.locator('div[role="dialog"], .fixed.z-50 h2:has-text("How 1-by-1 Queue Works")');
    await expect(modalHeading).toHaveCount(0);

    // 5. Also verify "How it works" button in header bar
    const howItWorksBtn = page.locator('button', { hasText: 'How it works' });
    if (await howItWorksBtn.isVisible()) {
      await howItWorksBtn.click();
      await page.waitForTimeout(300);

      const latestUrls = await page.evaluate(() => (window as any).__lastOpenedUrls);
      expect(latestUrls.filter((u: string) => u === 'https://downex.apps.gauravpatil.site/how-queues-work').length).toBeGreaterThanOrEqual(2);

      // Still no in-app modal
      await expect(modalHeading).toHaveCount(0);
    }
  });
});
