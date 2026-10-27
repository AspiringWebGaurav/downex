import { Page, expect } from '@playwright/test';

/**
 * Helper to attach console error and unhandled rejection listeners to a page
 */
export function captureConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out known benign browser noise if any
      if (!text.includes('favicon.ico') && !text.includes('net::ERR_FAILED')) {
        errors.push(`[Console Error] ${text}`);
      }
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`[Page Error] ${err.message}`);
  });
  return errors;
}

/**
 * Resets local test storage (localStorage and sessionStorage)
 */
export async function clearTestStorage(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      delete (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__;
      delete (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__;
    } catch {}
  });
}

/**
 * Verifies that all dummy items and mock artifacts are completely cleaned up
 */
export async function verifyCleanState(page: Page) {
  const state = await page.evaluate(() => {
    return {
      sessionStorageMock: sessionStorage.getItem('downex_mock_downloads'),
      windowDialogPayload: (window as any).__DOWNEX_MOCK_DIALOG_PAYLOAD__,
      windowCompletePayload: (window as any).__DOWNEX_MOCK_COMPLETE_PAYLOAD__,
    };
  });
  expect(state.sessionStorageMock).toBeNull();
  expect(state.windowDialogPayload).toBeUndefined();
  expect(state.windowCompletePayload).toBeUndefined();
}
