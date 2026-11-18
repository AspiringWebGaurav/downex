import { test, expect } from "@playwright/test";
import path from "path";

const ARTIFACT_DIR = "C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73";

test.describe("Downex Uninstalled Page & Real Anchor Link Verification", () => {
  test("loads instantly without preloader and displays exact CP/GPN-matched UI in light mode", async ({ page }) => {
    // 1. Navigate to /downex/uninstalled
    await page.goto("http://localhost:3000/downex/uninstalled", { waitUntil: "domcontentloaded" });

    // 2. Ensure PortfolioPreloader is completely bypassed (null / not in DOM or not busy)
    const preloader = page.locator("#portfolio-preloader");
    const preloaderCount = await preloader.count();
    expect(preloaderCount).toBe(0);

    // 3. Verify Page Title
    await expect(page).toHaveTitle(/Uninstalled \| Downex/);

    // 4. Verify Brand Link & Icon
    const brandLink = page.locator('a[title="Downex"]');
    await expect(brandLink).toBeVisible();
    await expect(brandLink).toHaveAttribute("href", "https://downex.apps.gauravpatil.site");
    await expect(brandLink).toHaveAttribute("target", "_blank");

    // 5. Verify Main Heading
    const heading = page.locator("h1");
    await expect(heading).toHaveText("Downex was uninstalled.");

    // 6. Verify Subtitle and Real Anchor Link
    const reinstallLink = page.locator('p a:has-text("Click here")');
    await expect(reinstallLink).toBeVisible();
    await expect(reinstallLink).toHaveAttribute("href", "https://downex.apps.gauravpatil.site");
    await expect(reinstallLink).toHaveAttribute("target", "_blank");

    // 7. Verify Navigation Links
    const docsLink = page.locator('nav a:has-text("Docs")');
    const appLink = page.locator('nav a:has-text("App")');
    const portfolioLink = page.locator('nav a:has-text("Portfolio")');

    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute("target", "_blank");

    await expect(appLink).toBeVisible();
    await expect(appLink).toHaveAttribute("href", "https://downex.apps.gauravpatil.site");
    await expect(appLink).toHaveAttribute("target", "_blank");

    await expect(portfolioLink).toBeVisible();
    await expect(portfolioLink).toHaveAttribute("href", "https://gauravpatil.site");
    await expect(portfolioLink).toHaveAttribute("target", "_blank");

    // Force light mode for clean capture
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    });
    await page.waitForTimeout(300);

    // Capture Light Mode Screenshot
    const lightScreenshotPath = path.join(ARTIFACT_DIR, "08-downex-uninstalled-light.png");
    await page.screenshot({ path: lightScreenshotPath, fullPage: true });

    // 8. Test Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    });
    await page.waitForTimeout(300);

    // Capture Dark Mode Screenshot
    const darkScreenshotPath = path.join(ARTIFACT_DIR, "09-downex-uninstalled-dark.png");
    await page.screenshot({ path: darkScreenshotPath, fullPage: true });
  });

  test("loads cleanly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost:3000/downex/uninstalled", { waitUntil: "networkidle" });

    // Verify heading is visible and properly wrapped
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();

    const reinstallLink = page.locator('p a:has-text("Click here")');
    await expect(reinstallLink).toBeVisible();

    const mobileScreenshotPath = path.join(ARTIFACT_DIR, "10-downex-uninstalled-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });
  });
});
