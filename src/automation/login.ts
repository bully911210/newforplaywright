import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";
import type { Page } from "playwright";

/**
 * Dismiss any popup/overlay that appears after login.
 * MMX shows a notification popup after login that blocks the contentframe.
 * Clicking anywhere outside the popup dismisses it.
 */
async function dismissPostLoginPopup(page: Page): Promise<void> {
  try {
    await page.waitForTimeout(1500);

    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) return;

    // Strategy 1: Check for any visible modal inside contentframe and dismiss it
    const modal = contentFrame.locator('.modal.fade.in, .modal.show, [class*="modal"][style*="display: block"]');
    if (await modal.first().isVisible().catch(() => false)) {
      log("info", "Post-login popup detected, dismissing...");

      // Try clicking the close/OK button first
      const closeBtn = contentFrame.locator('.modal.fade.in .btn, .modal.fade.in .close, .modal.show .btn, .modal.show .close');
      if (await closeBtn.first().isVisible().catch(() => false)) {
        await closeBtn.first().click({ force: true });
        log("info", "Dismissed popup via close/OK button");
        await page.waitForTimeout(1000);
        return;
      }

      // Try clicking outside the modal (on the backdrop)
      const backdrop = contentFrame.locator('.modal-backdrop');
      if (await backdrop.isVisible().catch(() => false)) {
        await backdrop.click({ force: true, position: { x: 10, y: 10 } });
        log("info", "Dismissed popup by clicking backdrop");
        await page.waitForTimeout(1000);
        return;
      }

      // Last resort: press Escape
      await page.keyboard.press("Escape");
      log("info", "Dismissed popup via Escape key");
      await page.waitForTimeout(1000);
      return;
    }

    // Strategy 2: Check for any overlay/popup on the main page (outside frames)
    const mainModal = page.locator('.modal.fade.in, .modal.show, [class*="popup"], [class*="overlay"]');
    if (await mainModal.first().isVisible().catch(() => false)) {
      log("info", "Post-login popup detected on main page, pressing Escape");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      return;
    }

    // Strategy 3: Click on the page body to dismiss any floating popup
    // The user said "click anywhere but on the popup to make it disappear"
    await page.mouse.click(100, 100);
    await page.waitForTimeout(500);
    log("info", "Clicked page body to dismiss any floating popup");
  } catch (err) {
    log("warn", `Post-login popup dismiss failed (non-critical): ${err}`);
  }
}

export async function loginToMMX(
  username?: string,
  password?: string,
  forceRelogin: boolean = false
): Promise<ToolResult> {
  const config = getConfig();
  const user = username || config.mmxUsername;
  const pass = password || config.mmxPassword;

  if (!user || !pass) {
    return { success: false, message: "Missing MMX credentials. Set MMX_USERNAME and MMX_PASSWORD in .env" };
  }

  const page = await getPage();

  // ALWAYS navigate to the login page first - never skip this step
  log("info", "Navigating to login page (always required)");
  await page.goto(`${config.mmxBaseUrl}/login.aspx`, {
    waitUntil: "networkidle",
    timeout: config.navigationTimeout,
  });
  await page.waitForTimeout(1000);

  try {
    const currentUrl = page.url();

    // If we're redirected away from login (session still valid), we're already logged in
    if (!currentUrl.toLowerCase().includes("login")) {
      log("info", `Already logged in, redirected to: ${currentUrl}`);
      return { success: true, message: `Already logged in. Current page: ${currentUrl}` };
    }

    // We're on the login page - fill credentials and login
    // Calibrated selectors:
    // - Username: #txtUsername (type="text")
    // - Password: #txtPassword (type="text" - NOT type="password"!)
    // - Login button: input[name="loginButton"]
    // - HONEYPOT button: input[name="HAHA"] - DO NOT CLICK THIS

    await page.waitForSelector("#txtUsername", { timeout: config.actionTimeout });

    // Clear and fill credentials
    await page.click("#txtUsername", { clickCount: 3 });
    await page.fill("#txtUsername", user);
    await page.waitForTimeout(300);

    await page.click("#txtPassword", { clickCount: 3 });
    await page.fill("#txtPassword", pass);
    await page.waitForTimeout(500);

    log("info", `Credentials entered (user=${user}, pass length=${pass.length}), clicking login button`);

    // Click the REAL login button (NOT the honeypot "HAHA" button)
    await page.click('input[name="loginButton"]');

    // Wait for navigation after login
    await page.waitForLoadState("networkidle", { timeout: config.navigationTimeout });
    await page.waitForTimeout(2000);

    // Verify login succeeded
    // NOTE: The URL stays on login.aspx even after successful login!
    // After login, the page becomes a frameset with a "contentframe" iframe
    // loading ClientSearch.aspx. The login form (#txtUsername) disappears.
    const afterUrl = page.url();
    const loginFormStillVisible = await page.isVisible("#txtUsername").catch(() => false);

    if (loginFormStillVisible) {
      // Login form is still showing - login actually failed
      const errorText = await page.textContent(".error, .validation-summary-errors, [id*='lblError']").catch(() => null);
      return {
        success: false,
        message: `Login failed. ${errorText ? `Error: ${errorText}` : `Login form still visible after submit.`}`,
      };
    }

    // Login form gone = success. Check for the contentframe to confirm.
    const hasContentFrame = await page.isVisible('frame[name="contentframe"], iframe[name="contentframe"]').catch(() => false);
    log("info", `Login successful. URL: ${afterUrl}, contentframe present: ${hasContentFrame}`);

    // Dismiss any post-login popup/overlay that may block the contentframe.
    // These popups can be dismissed by clicking anywhere outside them.
    await dismissPostLoginPopup(page);

    return { success: true, message: `Login successful. Content frame loaded: ${hasContentFrame}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Login error: ${msg}`);
    return { success: false, message: `Login error: ${msg}` };
  }
}
