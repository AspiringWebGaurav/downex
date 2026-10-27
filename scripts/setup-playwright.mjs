import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import playwright from 'playwright-core';

/**
 * setup-playwright.mjs
 * 
 * Ensures Playwright is completely configured to use offline local browser binaries,
 * resolving the Playwright CDN 404 issue by linking existing local Chrome/Chromium 
 * installations without remote downloads.
 */

export function resolveLocalBrowser() {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const msPlaywrightDir = path.join(localAppData, 'ms-playwright');

  if (!fs.existsSync(msPlaywrightDir)) {
    fs.mkdirSync(msPlaywrightDir, { recursive: true });
  }

  // Read browsers.json to know the expected revision
  let expectedRevision = '1208';
  try {
    const browsersJsonPath = path.resolve('node_modules', 'playwright-core', 'browsers.json');
    if (fs.existsSync(browsersJsonPath)) {
      const data = JSON.parse(fs.readFileSync(browsersJsonPath, 'utf8'));
      const chromiumEntry = data.browsers?.find((b) => b.name === 'chromium');
      if (chromiumEntry) {
        expectedRevision = chromiumEntry.revision;
      }
    }
  } catch (err) {
    console.warn('[Playwright Setup] Could not read browsers.json:', err.message);
  }

  const targetDir = path.join(msPlaywrightDir, `chromium-${expectedRevision}`);
  const targetHeadlessDir = path.join(msPlaywrightDir, `chromium_headless_shell-${expectedRevision}`);

  // Find any existing installed chromium versions
  const entries = fs.readdirSync(msPlaywrightDir, { withFileTypes: true });
  const chromiumDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('chromium-') && !e.name.startsWith('chromium-headless'))
    .map((e) => e.name)
    .sort()
    .reverse();

  const headlessDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('chromium_headless_shell-'))
    .map((e) => e.name)
    .sort()
    .reverse();

  let sourceChromium = chromiumDirs.find((d) => {
    const exe = path.join(msPlaywrightDir, d, 'chrome-win64', 'chrome.exe');
    return fs.existsSync(exe);
  });

  let sourceHeadless = headlessDirs.find((d) => {
    const exe = path.join(msPlaywrightDir, d, 'chrome-win64', 'chrome-headless-shell.exe');
    return fs.existsSync(exe);
  });

  if (sourceChromium && !fs.existsSync(targetDir)) {
    const srcPath = path.join(msPlaywrightDir, sourceChromium);
    console.log(`[Playwright Setup] Linking ${sourceChromium} -> chromium-${expectedRevision}...`);
    try {
      execSync(`cmd /c mklink /J "${targetDir}" "${srcPath}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('[Playwright Setup] Junction failed, copying folder:', e.message);
      fs.cpSync(srcPath, targetDir, { recursive: true });
    }
  }

  if (sourceHeadless && !fs.existsSync(targetHeadlessDir)) {
    const srcPath = path.join(msPlaywrightDir, sourceHeadless);
    console.log(`[Playwright Setup] Linking ${sourceHeadless} -> chromium_headless_shell-${expectedRevision}...`);
    try {
      execSync(`cmd /c mklink /J "${targetHeadlessDir}" "${srcPath}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('[Playwright Setup] Junction failed, copying folder:', e.message);
      fs.cpSync(srcPath, targetHeadlessDir, { recursive: true });
    }
  }

  // Determine viable executable path
  let viableExecutablePath = null;
  const candidatePaths = [
    path.join(targetDir, 'chrome-win64', 'chrome.exe'),
    sourceChromium ? path.join(msPlaywrightDir, sourceChromium, 'chrome-win64', 'chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      viableExecutablePath = p;
      break;
    }
  }

  return {
    expectedRevision,
    targetDir,
    viableExecutablePath,
  };
}

async function main() {
  console.log('=== Downex Playwright Local Environment Diagnostics ===');
  const res = resolveLocalBrowser();
  console.log('Expected Chromium Revision:', res.expectedRevision);
  console.log('Target Directory:', res.targetDir);
  console.log('Viable Executable Path:', res.viableExecutablePath);

  if (!res.viableExecutablePath) {
    console.error('❌ No local Chromium or Edge browser executable found on system.');
    process.exit(1);
  }

  // Verify launch
  try {
    const launchOptions = {
      headless: true,
      ...(res.viableExecutablePath ? { executablePath: res.viableExecutablePath } : {}),
    };
    const browser = await playwright.chromium.launch(launchOptions);
    const ver = browser.version();
    console.log(`✅ Local browser launch test passed! (Browser Version: ${ver})`);
    await browser.close();
    console.log('✅ Playwright local testing environment verified and ready (Zero network dependencies).');
  } catch (err) {
    console.error('❌ Failed to launch browser locally:', err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('setup-playwright.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
