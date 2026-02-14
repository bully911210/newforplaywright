import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

export async function fillClientSearch(
  clientType: string = "Domestic",
  product: string
): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();

  try {
    // After login, the main page stays on login.aspx and loads a frameset.
    // ClientSearch.aspx is loaded inside a frame called "contentframe".
    // All interactions must happen inside that frame.

    // Access the content frame where ClientSearch lives
    log("info", "Accessing contentframe (ClientSearch.aspx)");
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      return {
        success: false,
        message: "Content frame not found. Is the user logged in? Run login_mmx first.",
      };
    }

    // Wait for the frame to have content
    await contentFrame.waitForLoadState("networkidle", { timeout: config.navigationTimeout });
    const frameUrl = contentFrame.url();
    log("info", `Content frame URL: ${frameUrl}`);

    // Step 0: Dismiss any popup/overlay that might be blocking the page
    log("info", "Dismissing any popups/overlays before interacting");
    try {
      // Check for Bootstrap modal inside contentframe
      const modal = contentFrame.locator('.modal.fade.in, .modal.show, [class*="modal"][style*="display: block"]');
      if (await modal.first().isVisible({ timeout: 1500 }).catch(() => false)) {
        log("info", "Modal detected in contentframe, dismissing...");
        // Try close/OK button
        const closeBtn = contentFrame.locator('.modal .btn, .modal .close, .modal .btn-primary, .modal .btn-default');
        if (await closeBtn.first().isVisible().catch(() => false)) {
          await closeBtn.first().click({ force: true });
          log("info", "Dismissed modal via button");
          await page.waitForTimeout(1000);
        } else {
          await page.keyboard.press("Escape");
          log("info", "Dismissed modal via Escape");
          await page.waitForTimeout(1000);
        }
      }
      // Also check main page for overlays
      const mainModal = page.locator('.modal.fade.in, .modal.show, [class*="popup"], [class*="overlay"]');
      if (await mainModal.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        log("info", "Dismissed main page overlay via Escape");
      }
    } catch {
      // No modal, continue
    }

    // Step 0b: Check for session expiry modal specifically
    log("info", "Checking for session expiry modal");
    try {
      const sessionModal = contentFrame.locator('#modalMessage.modal.fade.in');
      if (await sessionModal.isVisible({ timeout: 1000 }).catch(() => false)) {
        return {
          success: false,
          message: "Session expired (modal popup detected). Please run login_mmx first.",
        };
      }
    } catch {
      // No modal, continue
    }

    // Step 1: Click "New" tab and VERIFY the tab content actually switched.
    // The tab uses jQuery UI tabs or Bootstrap tabs. Using force:true can change
    // the visual state without triggering the JS event handler that swaps panels.
    // We need to click WITHOUT force, or use JS to trigger the tab switch.
    log("info", "Clicking 'New' tab");
    const newTab = contentFrame.locator('a[href="#tabsNew"]').first();
    await newTab.waitFor({ state: "visible", timeout: config.actionTimeout });

    // First attempt: normal click (triggers JS event handlers properly)
    await newTab.click();
    await page.waitForTimeout(1500);

    // Verify the "New" tab panel is actually showing by checking if the radio button is visible
    const radioId = clientType === "Domestic"
      ? "#rblDomesticCommercial_0"
      : "#rblDomesticCommercial_1";
    let radioVisible = await contentFrame.locator(radioId).isVisible().catch(() => false);

    if (!radioVisible) {
      log("warn", "New tab content not showing after click, trying JS tab activation");
      // Use JavaScript to activate the tab panel directly
      await contentFrame.evaluate(() => {
        // Hide all tab panels
        const allPanels = document.querySelectorAll('.tab-pane, [id^="tabs"]');
        allPanels.forEach(p => {
          (p as HTMLElement).style.display = 'none';
          p.classList.remove('active', 'in');
        });
        // Show the New tab panel
        const newPanel = document.getElementById('tabsNew');
        if (newPanel) {
          newPanel.style.display = 'block';
          newPanel.classList.add('active', 'in');
        }
        // Also try jQuery if available
        try {
          (window as any).$('a[href="#tabsNew"]').tab('show');
        } catch {}
        try {
          (window as any).$('#tabsNew').show();
        } catch {}
      });
      await page.waitForTimeout(1500);
      radioVisible = await contentFrame.locator(radioId).isVisible().catch(() => false);
    }

    if (!radioVisible) {
      log("warn", "Still not visible after JS activation, trying second click approach");
      // Try clicking the tab link text directly
      await contentFrame.locator('text=New').first().click();
      await page.waitForTimeout(1500);
      radioVisible = await contentFrame.locator(radioId).isVisible().catch(() => false);
    }

    if (!radioVisible) {
      log("warn", "Third attempt: clicking tab with dispatchEvent");
      await contentFrame.evaluate(() => {
        const tabLink = document.querySelector('a[href="#tabsNew"]');
        if (tabLink) {
          tabLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      });
      await page.waitForTimeout(2000);
      radioVisible = await contentFrame.locator(radioId).isVisible().catch(() => false);
    }

    if (!radioVisible) {
      // Take a diagnostic screenshot before failing
      log("error", "New tab panel never became visible after all attempts");
      const html = await contentFrame.content().catch(() => "N/A");
      const hasTabsNew = html.includes('tabsNew');
      const hasRadio = html.includes('rblDomesticCommercial_0');
      log("error", `DOM check: tabsNew exists=${hasTabsNew}, radio exists=${hasRadio}`);
      return {
        success: false,
        message: "New tab content panel did not become visible. The radio buttons are hidden.",
      };
    }

    // Step 2: Select client type radio button
    log("info", `Selecting client type: ${clientType}`);
    await contentFrame.click(radioId);

    // Step 3: Wait for product dropdown to populate after radio selection
    log("info", "Waiting for product dropdown to populate...");
    await page.waitForTimeout(2000);

    // Step 4: Select product from dropdown #ddlProductCodes
    log("info", `Selecting product: ${product}`);
    const dropdown = contentFrame.locator("#ddlProductCodes");
    await dropdown.waitFor({ state: "visible", timeout: config.actionTimeout });

    // Try selecting by label first (e.g., "GW6 - CIV DOMESTIC DONATION NPC")
    try {
      await dropdown.selectOption({ label: product });
    } catch {
      // If exact label match fails, try by value or partial match
      const options = await dropdown.locator("option").all();
      let matched = false;
      for (const option of options) {
        const text = await option.textContent();
        if (text && text.includes(product)) {
          const value = await option.getAttribute("value");
          if (value) {
            await dropdown.selectOption(value);
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        // Try selecting by value directly
        await dropdown.selectOption(product);
      }
    }

    await page.waitForTimeout(1000);

    // Step 5: Click "New Client" button (#btnNewClient)
    // This button may be hidden until product is selected
    log("info", "Clicking New Client button");
    const newClientBtn = contentFrame.locator("#btnNewClient");

    // Try to make it visible via JavaScript if needed
    try {
      await newClientBtn.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      // Button might be hidden via CSS - try making it visible
      log("info", "New Client button not visible, trying to reveal it");
      await contentFrame.evaluate(() => {
        const btn = document.getElementById("btnNewClient");
        if (btn) {
          (btn as HTMLElement).style.display = "inline-block";
          (btn as HTMLElement).style.visibility = "visible";
        }
      });
      await page.waitForTimeout(500);
    }

    await newClientBtn.click();

    // Wait for the content frame to load the next page (Policy Details)
    await contentFrame.waitForLoadState("networkidle", { timeout: config.navigationTimeout });

    const currentUrl = contentFrame.url();
    log("info", `New Client clicked, content frame now on: ${currentUrl}`);

    return {
      success: true,
      message: `Client search completed. Type: ${clientType}, Product: ${product}. Content frame: ${currentUrl}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Client search error: ${msg}`);
    return { success: false, message: `Client search error: ${msg}` };
  }
}
