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

    // Step 0: Check for modal dialog - if present, session is expired
    log("info", "Checking for session expiry modal");
    try {
      const modal = contentFrame.locator('#modalMessage.modal.fade.in, .modal.fade.in');
      if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
        return {
          success: false,
          message: "Session expired (modal popup detected). Please run login_mmx first.",
        };
      }
    } catch {
      // No modal, continue
    }

    // Step 1: Click "New" tab
    log("info", "Clicking 'New' tab");
    const newTab = contentFrame.locator('a[href="#tabsNew"]').first();
    await newTab.waitFor({ state: "visible", timeout: config.actionTimeout });
    await newTab.click({ force: true });
    await page.waitForTimeout(1000);

    // Step 2: Select client type radio button
    // Domestic: #rblDomesticCommercial_0 (value="DOM")
    // Commercial: #rblDomesticCommercial_1 (value="COM")
    log("info", `Selecting client type: ${clientType}`);
    const radioId = clientType === "Domestic"
      ? "#rblDomesticCommercial_0"
      : "#rblDomesticCommercial_1";

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
