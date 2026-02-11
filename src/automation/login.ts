import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

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
    return { success: true, message: `Login successful. Content frame loaded: ${hasContentFrame}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Login error: ${msg}`);
    return { success: false, message: `Login error: ${msg}` };
  }
}
