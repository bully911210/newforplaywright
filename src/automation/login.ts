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
    // Wait for post-login page to settle — popups appear after a brief delay
    await page.waitForTimeout(2000);

    // Strategy 1: Press Escape universally — this dismisses most modals/popups
    log("info", "Pressing Escape to dismiss any post-login popup");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Strategy 2: Check contentframe for Bootstrap modals
    const contentFrame = page.frame({ name: "contentframe" });
    if (contentFrame) {
      const modal = contentFrame.locator('.modal.fade.in, .modal.show, [class*="modal"][style*="display: block"]');
      if (await modal.first().isVisible().catch(() => false)) {
        log("info", "Post-login modal detected in contentframe");

        // Try clicking any button inside the modal (OK, Close, etc.)
        const modalBtn = contentFrame.locator('.modal .btn, .modal .close, .modal .btn-primary, .modal .btn-default, .modal .btn-secondary');
        if (await modalBtn.first().isVisible().catch(() => false)) {
          await modalBtn.first().click({ force: true });
          log("info", "Dismissed modal via button click");
          await page.waitForTimeout(1000);
        } else {
          // Click the backdrop
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          log("info", "Dismissed modal via Escape");
        }

        // Double-check it's gone
        if (await modal.first().isVisible().catch(() => false)) {
          // Force-remove via JS
          await contentFrame.evaluate(() => {
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.querySelectorAll('.modal.fade.in, .modal.show').forEach(el => {
              (el as HTMLElement).style.display = 'none';
              el.classList.remove('in', 'show');
            });
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
          });
          log("info", "Force-removed modal via JS");
          await page.waitForTimeout(500);
        }
      }
    }

    // Strategy 3: Check main page for overlays/popups
    const mainModal = page.locator('.modal.fade.in, .modal.show, [class*="popup"], [class*="overlay"]');
    if (await mainModal.first().isVisible().catch(() => false)) {
      log("info", "Post-login popup detected on main page");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Force-remove if still there
      if (await mainModal.first().isVisible().catch(() => false)) {
        await page.evaluate(() => {
          document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
          document.querySelectorAll('.modal.fade.in, .modal.show').forEach(el => {
            (el as HTMLElement).style.display = 'none';
            el.classList.remove('in', 'show');
          });
          document.body.classList.remove('modal-open');
          document.body.style.overflow = '';
        });
        log("info", "Force-removed main page modal via JS");
      }
    }

    // Strategy 4: Click on the page body to dismiss any floating popup
    // The user said "click anywhere but on the popup to make it disappear"
    await page.mouse.click(100, 100);
    await page.waitForTimeout(500);
    log("info", "Clicked page body (100,100) to dismiss any floating popup");
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
