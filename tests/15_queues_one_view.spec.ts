import { test, expect } from '@playwright/test';
import { clearTestStorage } from './helpers/test-utils';

test.describe('Downex — Queues Empty State One-View UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearTestStorage(page);
  });

  test('Queues view has no vertical gap, fills space cleanly, and has NO vertical scrollbar at 960x640', async ({ page }) => {
    // 1. Set standard window size 960x640
    await page.setViewportSize({ width: 960, height: 640 });

    // 2. Click Queues in the sidebar
    const queuesNav = page.locator('button', { hasText: 'Queues' });
    await queuesNav.click();
    await page.waitForTimeout(200);

    // 3. Locate the queue banner card and the walkthrough heading
    const queueBanner = page.locator('div.rounded-xl', { hasText: 'Simple 1-by-1 Queue' }).first();
    await expect(queueBanner).toBeVisible();

    const walkthrough = page.locator('h3', { hasText: 'How 1-by-1 Queue Works' });
    await expect(walkthrough).toBeVisible();

    // 4. Measure gap between banner bottom and walkthrough top
    const bannerBox = await queueBanner.boundingBox();
    const walkthroughBox = await walkthrough.boundingBox();
    console.log('BANNER BOX:', bannerBox);
    console.log('WALKTHROUGH BOX:', walkthroughBox);
    expect(bannerBox).not.toBeNull();
    expect(walkthroughBox).not.toBeNull();

    if (bannerBox && walkthroughBox) {
      const bannerBottom = bannerBox.y + bannerBox.height;
      const walkthroughTop = walkthroughBox.y;
      // Gap should be compact (between 25px and 60px including the icon), definitely NOT ~120-150px
      const verticalGap = walkthroughTop - bannerBottom;
      expect(verticalGap).toBeLessThan(70);
      expect(verticalGap).toBeGreaterThan(10);
    }

    // 5. Verify 3 cards exist in 3-column layout
    const card1 = page.locator('span', { hasText: 'Add & Choose Later' });
    const card2 = page.locator('span', { hasText: 'Lines Up in Order' });
    const card3 = page.locator('span', { hasText: 'Sequential 1-by-1' });

    await expect(card1).toBeVisible();
    await expect(card2).toBeVisible();
    await expect(card3).toBeVisible();

    const box1 = await card1.boundingBox();
    const box2 = await card2.boundingBox();
    const box3 = await card3.boundingBox();

    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    expect(box3).not.toBeNull();

    if (box1 && box2 && box3) {
      // All 3 cards must be arranged horizontally (increasing X coordinates)
      expect(box2.x).toBeGreaterThan(box1.x);
      expect(box3.x).toBeGreaterThan(box2.x);
      // All 3 cards must be approximately on the same horizontal line
      expect(Math.abs(box1.y - box2.y)).toBeLessThan(10);
      expect(Math.abs(box2.y - box3.y)).toBeLessThan(10);
    }

    // 6. Verify Buttons
    const addBtn = page.locator('button', { hasText: 'Add Download to Queue' });
    const guideBtn = page.locator('button', { hasText: 'How Queues Work' });
    await expect(addBtn).toBeVisible();
    await expect(guideBtn).toBeVisible();

    // 7. Verify NO vertical scrollbar in the scroll container
    const scrollContainer = page.locator('div.flex-1.overflow-y-auto');
    await expect(scrollContainer).toBeVisible();

    const isScrollable = await scrollContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(isScrollable).toBe(false);

    // Take screenshot for visual audit
    await page.screenshot({ path: 'test-results/queues-one-view-960x640.png' });
  });

  test('Queues view maintains one-view and NO vertical scrollbar at min window size 820x540', async ({ page }) => {
    // 1. Set minimum window size 820x540
    await page.setViewportSize({ width: 820, height: 540 });

    // 2. Click Queues in the sidebar
    const queuesNav = page.locator('button', { hasText: 'Queues' });
    await queuesNav.click();
    await page.waitForTimeout(200);

    // 3. Verify elements are visible
    await expect(page.locator('h3', { hasText: 'How 1-by-1 Queue Works' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Add Download to Queue' })).toBeVisible();

    // 4. Verify NO vertical scrollbar even at minimum 540px height!
    const scrollContainer = page.locator('div.flex-1.overflow-y-auto');
    const isScrollable = await scrollContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(isScrollable).toBe(false);

    // Take screenshot for visual audit
    await page.screenshot({ path: 'test-results/queues-one-view-820x540.png' });
  });

  test('Queues view looks beautiful and has NO vertical scrollbar in Dark Mode at 960x640', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    // Toggle dark mode
    const darkModeBtn = page.locator('button', { hasText: 'Dark Mode' });
    await darkModeBtn.click();
    await page.waitForTimeout(200);

    const queuesNav = page.locator('button', { hasText: 'Queues' });
    await queuesNav.click();
    await page.waitForTimeout(200);

    const scrollContainer = page.locator('div.flex-1.overflow-y-auto');
    const isScrollable = await scrollContainer.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(isScrollable).toBe(false);

    await page.screenshot({ path: 'test-results/queues-one-view-dark.png' });
  });
});
