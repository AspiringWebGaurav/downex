import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const ARTIFACT_DIR = "C:/Users/gaura/.gemini/antigravity/brain/824a77c2-6222-490a-9327-590aceee3b73";

// Read and embed the exact Downex HD Logo (512x512 violet brand icon)
const LOGO_BUFFER = fs.readFileSync("C:/GITHUB/gaurav-webdev-portfolio/public/brand/downex-logo.png");
const LOGO_URI = `data:image/png;base64,${LOGO_BUFFER.toString("base64")}`;

const NSIS_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f172a;
    font-family: "Segoe UI", Tahoma, sans-serif;
    font-size: 11px;
    color: #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 0;
    margin: 0;
  }
  .nsis-window {
    width: 504px;
    height: 396px;
    background: #f0f0f0;
    border: 1px solid #707070;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    position: relative;
    user-select: none;
    border-radius: 6px;
    overflow: hidden;
  }
  .title-bar {
    height: 30px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border-bottom: 1px solid #e5e5e5;
  }
  .title-text {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    color: #1a1a1a;
  }
  .title-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
  .title-controls {
    display: flex;
    gap: 14px;
    color: #444;
    font-size: 11px;
  }
  .header-banner {
    height: 60px;
    background: #ffffff;
    border-bottom: 1px solid #d9d9d9;
    padding: 10px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-titles h2 {
    font-size: 12px;
    font-weight: 700;
    color: #000;
    margin-bottom: 2px;
  }
  .header-titles p {
    font-size: 11px;
    color: #333;
  }
  .header-logo-container {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
  }
  .header-logo-img {
    width: 38px;
    height: 38px;
    object-fit: contain;
    filter: drop-shadow(0 2px 4px rgba(124,58,237,0.25));
  }
  .dialog-body {
    flex: 1;
    padding: 10px 18px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    background: #f0f0f0;
  }
  .group-box {
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    padding: 10px 14px;
    background: #fafafa;
    margin-top: 4px;
  }
  .group-title {
    font-size: 11px;
    font-weight: 600;
    color: #333;
    margin-bottom: 8px;
  }
  .checkbox-row, .radio-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 7px;
    cursor: pointer;
    font-size: 11px;
  }
  .checkbox-row input, .radio-row input {
    margin-top: 2px;
    accent-color: #7c3aed;
  }
  .radio-desc {
    color: #555;
    font-size: 10px;
    margin-top: 1px;
    line-height: 1.3;
  }
  .license-box {
    background: #fff;
    border: 1px solid #aaa;
    padding: 8px 10px;
    font-family: "Consolas", monospace;
    font-size: 10px;
    line-height: 1.4;
    overflow-y: scroll;
    height: 105px;
    color: #222;
    margin-bottom: 8px;
  }
  .dialog-footer {
    height: 48px;
    border-top: 1px solid #d9d9d9;
    background: #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
  }
  .branding-text {
    font-size: 10px;
    color: #777;
  }
  .button-group {
    display: flex;
    gap: 8px;
  }
  .btn {
    min-width: 76px;
    height: 24px;
    padding: 0 12px;
    background: #e1e1e1;
    border: 1px solid #adadad;
    border-radius: 2px;
    font-size: 11px;
    color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .btn.primary {
    border-color: #7c3aed;
    background: #7c3aed;
    color: #fff;
    font-weight: 600;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: #e1e1e1;
    color: #888;
    border-color: #ccc;
  }
`;

test.describe("Downex NSIS Dialog Visual Simulator — HD Logo Edition", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 450 });
  });

  test("capture Installer Screen 1: License Agreement with Checkbox & HD Logo", async ({ page }) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><style>${NSIS_STYLE}</style></head>
      <body>
        <div class="nsis-window">
          <div class="title-bar">
            <div class="title-text">
              <img src="${LOGO_URI}" class="title-icon" alt="Downex Icon" />
              <span>Downex Download Manager Setup</span>
            </div>
            <div class="title-controls"><span>&#8212;</span><span>&#9633;</span><span>&#10005;</span></div>
          </div>
          <div class="header-banner">
            <div class="header-titles">
              <h2>Downex Download Manager Setup</h2>
              <p>End User Acceptance Agreement</p>
            </div>
            <div class="header-logo-container">
              <img src="${LOGO_URI}" class="header-logo-img" alt="Downex HD Logo" />
            </div>
          </div>
          <div class="dialog-body">
            <p style="margin-bottom: 6px; font-size: 11px; color: #333;">Please review the license terms before installing Downex Download Manager.</p>
            <div class="license-box">
              <strong>Downex License Agreement</strong><br><br>
              1. The Downex download manager software, artwork and other components included in this version of product (collectively the "Software") are the property of Downex. You must not (a) sell, rent, lease or sublicense all or any portion of the Software; (b) modify or prepare derivative works of the Software; (c) reverse engineer, decompile or disassemble the Software without authorization.<br><br>
              2. You are granted a personal license to use Downex for legal downloading and queue management on your computers.<br><br>
              3. The software is provided "as is" with automatic background OTA updates for reliability.
            </div>
            <p style="font-size: 11px; color: #444; margin-bottom: 8px;">If you accept the terms of the agreement, click the check box below. You must accept the agreement to install Downex Download Manager.</p>
            <div class="checkbox-row">
              <input type="checkbox" id="agree" checked>
              <label for="agree" style="font-weight: 600; cursor: pointer;">I accept the terms of the Use &amp; Acceptance Agreement</label>
            </div>
          </div>
          <div class="dialog-footer">
            <span class="branding-text">Nullsoft Install System v3.13</span>
            <div class="button-group">
              <button class="btn" disabled>&lt; Back</button>
              <button class="btn primary">Next &gt;</button>
              <button class="btn">Cancel</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    await page.setContent(html);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "11-nsis-install-screen1-agreement.png") });
  });

  test("capture Installer Screen 2: System Preferences & Integration with HD Logo", async ({ page }) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><style>${NSIS_STYLE}</style></head>
      <body>
        <div class="nsis-window">
          <div class="title-bar">
            <div class="title-text">
              <img src="${LOGO_URI}" class="title-icon" alt="Downex Icon" />
              <span>Downex Download Manager Setup</span>
            </div>
            <div class="title-controls"><span>&#8212;</span><span>&#9633;</span><span>&#10005;</span></div>
          </div>
          <div class="header-banner">
            <div class="header-titles">
              <h2>System Preferences</h2>
              <p>Choose startup options, shortcuts, and network integration for Downex</p>
            </div>
            <div class="header-logo-container">
              <img src="${LOGO_URI}" class="header-logo-img" alt="Downex HD Logo" />
            </div>
          </div>
          <div class="dialog-body">
            <p style="margin-bottom: 2px; font-size: 11px; color: #333;">Select your installation preferences for Downex:</p>
            <div class="group-box">
              <div class="group-title">Preferences and Network Integration</div>
              <div class="checkbox-row">
                <input type="checkbox" id="c1" checked>
                <label for="c1">Start Downex automatically when Windows starts (Recommended)</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="c2" checked>
                <label for="c2">Create a Desktop shortcut</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="c3" checked>
                <label for="c3">Add Windows Firewall inbound exception for multi-threaded downloads (Recommended)</label>
              </div>
              <div class="checkbox-row" style="margin-bottom: 0;">
                <input type="checkbox" id="c4" checked>
                <label for="c4">Keep an automatic backup snapshot to safely restore Downex (Recommended)</label>
              </div>
            </div>
            <div class="group-box" style="margin-top: 6px;">
              <div class="group-title">Installation Details</div>
              <p style="font-size: 10px; color: #444; margin-bottom: 3px;">Install location: C:\\Users\\gaura\\AppData\\Local\\Programs\\Downex</p>
              <p style="font-size: 10px; color: #444;">Install for: Current user (No Administrator rights required)</p>
            </div>
          </div>
          <div class="dialog-footer">
            <span class="branding-text">Gaurav Patil &bull; downex.apps.gauravpatil.site</span>
            <div class="button-group">
              <button class="btn">&lt; Back</button>
              <button class="btn primary">Install</button>
              <button class="btn">Cancel</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    await page.setContent(html);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "12-nsis-install-screen2-options.png") });
  });

  test("capture Uninstaller Screen 1: Removal Options with SAME Downex HD Logo", async ({ page }) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><style>${NSIS_STYLE}</style></head>
      <body>
        <div class="nsis-window">
          <div class="title-bar">
            <div class="title-text">
              <img src="${LOGO_URI}" class="title-icon" alt="Downex Icon" />
              <span>Downex Download Manager Uninstall</span>
            </div>
            <div class="title-controls"><span>&#8212;</span><span>&#9633;</span><span>&#10005;</span></div>
          </div>
          <div class="header-banner">
            <div class="header-titles">
              <h2>Uninstall Downex</h2>
              <p>Choose how to handle your downloads, queue database, and settings.</p>
            </div>
            <div class="header-logo-container">
              <img src="${LOGO_URI}" class="header-logo-img" alt="Downex HD Logo" />
            </div>
          </div>
          <div class="dialog-body">
            <p style="margin-bottom: 8px; font-size: 11px; color: #333;">Please select an uninstallation option for Downex Download Manager:</p>
            
            <div class="group-box" style="margin-bottom: 8px;">
              <div class="radio-row">
                <input type="radio" name="opt" id="r1" checked>
                <div>
                  <label for="r1" style="font-weight: 600; cursor: pointer;">Option 1: Keep Downloaded Files &amp; History (Recommended)</label>
                  <div class="radio-desc">Removes the app, but keeps your saved downloads and task queue database intact.</div>
                </div>
              </div>
            </div>

            <div class="group-box" style="margin-bottom: 8px;">
              <div class="radio-row">
                <input type="radio" name="opt" id="r2">
                <div>
                  <label for="r2" style="font-weight: 600; cursor: pointer;">Option 2: Delete App &amp; Settings</label>
                  <div class="radio-desc">Removes the app and clears local settings and cache (%LOCALAPPDATA%\\Downex).</div>
                </div>
              </div>
            </div>

            <div class="group-box" style="margin-bottom: 8px;">
              <div class="radio-row">
                <input type="radio" name="opt" id="r3">
                <div>
                  <label for="r3" style="font-weight: 600; cursor: pointer;">Option 3: Complete Clean Wipe (Irreversible)</label>
                  <div class="radio-desc">Removes all binaries, queue database, settings, firewall rules, and registry entries.</div>
                </div>
              </div>
            </div>
          </div>
          <div class="dialog-footer">
            <span class="branding-text">Zero-hang exit &bull; Automatically launches feedback page</span>
            <div class="button-group">
              <button class="btn primary" style="background:#7c3aed; border-color:#7c3aed; color:#fff;">Uninstall</button>
              <button class="btn">Cancel</button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    await page.setContent(html);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "13-nsis-uninstall-screen1-options.png") });
  });
});
