import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

/**
 * Fill the Client tab (Donor info) inside #ifrmClient.
 * This is the first tab visible after clicking "New Client".
 *
 * Calibrated selectors inside #ifrmClient:
 *   Sub-tab: #tabli0 "Donor info"
 *   Name:           #txt2 [MANDATORY]
 *   Contact name:   #txt102 (surname)
 *   ID Number:      #txt6
 *   Cell phone:     #txt14
 *   Email:          #txt16
 *   Home phone:     #txt12
 *   Work phone:     #txt13
 *   Residential address 1: #txt21
 *   Residential address 2: #txt22 (city)
 *   Residential address 3: #txt23 (province)
 *   Residential postal code: #txt24
 *   Client inception date: #txt28 [MANDATORY]
 *   Postal same as residential: #txt55 (SELECT)
 */
export async function fillClientInfo(params: {
  name?: string;
  contactName?: string;
  idNumber?: string;
  cellphone?: string;
  email?: string;
  homePhone?: string;
  workPhone?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  postalCode?: string;
  inceptionDate?: string;
}): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();
  const fieldsSet: string[] = [];

  try {
    // Frame structure: main page (login.aspx) -> contentframe -> #ifrmClient
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      return { success: false, message: "Content frame not found. Is the user logged in?" };
    }

    // The Client tab should be active by default after New Client.
    // But ensure it's clicked just in case.
    log("info", "Ensuring Client tab is active in content frame");
    const clientTabLink = contentFrame.locator('a[href="#tabsClient"]');
    await clientTabLink.waitFor({ state: "visible", timeout: config.actionTimeout });
    await clientTabLink.click();
    await page.waitForTimeout(1000);

    // Access the Client iframe
    log("info", "Accessing Client iframe (#ifrmClient)");
    const clientIframe = contentFrame.frameLocator("#ifrmClient");

    // Name (#txt2) [MANDATORY]
    if (params.name) {
      log("info", `Setting donor name: ${params.name}`);
      const nameInput = clientIframe.locator("#txt2");
      await nameInput.click({ clickCount: 3 });
      await nameInput.fill(params.name);
      await nameInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("name");
    }

    // Contact name (#txt102) - typically the surname
    if (params.contactName) {
      log("info", `Setting contact name: ${params.contactName}`);
      const contactInput = clientIframe.locator("#txt102");
      await contactInput.click({ clickCount: 3 });
      await contactInput.fill(params.contactName);
      await contactInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("contactName");
    }

    // ID Number (#txt6)
    if (params.idNumber) {
      log("info", `Setting ID number: ${params.idNumber}`);
      const idInput = clientIframe.locator("#txt6");
      await idInput.click({ clickCount: 3 });
      await idInput.fill(params.idNumber);
      await idInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("idNumber");
    }

    // Cell phone number (#txt14)
    if (params.cellphone) {
      log("info", `Setting cell phone: ${params.cellphone}`);
      const cellInput = clientIframe.locator("#txt14");
      await cellInput.click({ clickCount: 3 });
      await cellInput.fill(params.cellphone);
      await cellInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("cellphone");
    }

    // Email (#txt16)
    if (params.email) {
      log("info", `Setting email: ${params.email}`);
      const emailInput = clientIframe.locator("#txt16");
      await emailInput.click({ clickCount: 3 });
      await emailInput.fill(params.email);
      await emailInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("email");
    }

    // Home telephone (#txt12)
    if (params.homePhone) {
      log("info", `Setting home phone: ${params.homePhone}`);
      const homeInput = clientIframe.locator("#txt12");
      await homeInput.click({ clickCount: 3 });
      await homeInput.fill(params.homePhone);
      await homeInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("homePhone");
    }

    // Work telephone (#txt13)
    if (params.workPhone) {
      log("info", `Setting work phone: ${params.workPhone}`);
      const workInput = clientIframe.locator("#txt13");
      await workInput.click({ clickCount: 3 });
      await workInput.fill(params.workPhone);
      await workInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("workPhone");
    }

    // Residential address 1 (#txt21)
    if (params.address1) {
      log("info", `Setting address line 1: ${params.address1}`);
      const addr1 = clientIframe.locator("#txt21");
      await addr1.click({ clickCount: 3 });
      await addr1.fill(params.address1);
      await addr1.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("address1");
    }

    // Residential address 2 (#txt22) - city
    if (params.address2) {
      log("info", `Setting address line 2 (city): ${params.address2}`);
      const addr2 = clientIframe.locator("#txt22");
      await addr2.click({ clickCount: 3 });
      await addr2.fill(params.address2);
      await addr2.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("address2");
    }

    // Residential address 3 (#txt23) - province
    if (params.address3) {
      log("info", `Setting address line 3 (province): ${params.address3}`);
      const addr3 = clientIframe.locator("#txt23");
      await addr3.click({ clickCount: 3 });
      await addr3.fill(params.address3);
      await addr3.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("address3");
    }

    // Residential postal code (#txt24)
    if (params.postalCode) {
      log("info", `Setting postal code: ${params.postalCode}`);
      const pcInput = clientIframe.locator("#txt24");
      await pcInput.click({ clickCount: 3 });
      await pcInput.fill(params.postalCode);
      await pcInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("postalCode");
    }

    // Client inception date (#txt28) [MANDATORY]
    if (params.inceptionDate) {
      log("info", `Setting client inception date: ${params.inceptionDate}`);
      const dateInput = clientIframe.locator("#txt28");
      await dateInput.click({ clickCount: 3 });
      await dateInput.fill(params.inceptionDate);
      await dateInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("inceptionDate");
    }

    // Set "Postal address same as residential" to Yes
    log("info", "Setting postal address = residential address");
    const postalSame = clientIframe.locator("#txt55");
    const isDisabled = await postalSame.getAttribute("disabled").catch(() => null);
    if (!isDisabled) {
      try {
        await postalSame.selectOption({ label: "Yes" });
      } catch {
        try {
          await postalSame.selectOption("Y");
        } catch {
          // Ignore if not available
        }
      }
      fieldsSet.push("postalSameAsResidential");
    }

    log("info", `Client info filled: ${fieldsSet.join(", ")}`);
    return {
      success: true,
      message: `Client info filled. Fields set: ${fieldsSet.join(", ")}`,
      data: { fieldsSet },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Client info error: ${msg}`);
    return { success: false, message: `Client info error: ${msg}`, data: { fieldsSet } };
  }
}
