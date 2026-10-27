import { defineConfig, devices } from '@playwright/test';
import { resolveLocalBrowser } from './scripts/setup-playwright.mjs';

const browserInfo = resolveLocalBrowser();

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    ...(browserInfo?.viableExecutablePath ? { executablePath: browserInfo.viableExecutablePath } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        ...(browserInfo?.viableExecutablePath ? { executablePath: browserInfo.viableExecutablePath } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev:frontend -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
