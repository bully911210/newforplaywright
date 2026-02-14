import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

export async function fillPolicyInfo(params: {
  npcCompanyCode?: string;
  paymentFrequency?: string;
  inceptionDate?: string;
  expiryDate?: string;
  reviewDate?: string;
  reviewMonth?: string;
}): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();
  const fieldsSet: string[] = [];

  log("info", `==== POLICY INFO START ====`);
  log("info", `RAW PARAMS: npcCompanyCode="${params.npcCompanyCode}", paymentFrequency="${params.paymentFrequency}", inceptionDate="${params.inceptionDate}", expiryDate="${params.expiryDate}", reviewDate="${params.reviewDate}", reviewMonth="${params.reviewMonth}"`);

  try {
    // The form content lives inside the #ifrmPolicy iframe.
    // We must interact with elements INSIDE the iframe, not on the main page.
    //
    // Calibrated selectors from live DOM inspection (inside #ifrmPolicy):
    //   Policy Info sub-tab: #tabli0
    //   Bank Details sub-tab: #tabli1
    //   NPC Company code: #txt5 (input), #txtDesc5 (readonly description)
    //   Payment frequency: #txt15 (SELECT)
    //   Inception date: #txt17 (input)
    //   Expiry date: #txt18 (input)
    //   Review date: #txt19 (input)
    //   Review month: #txt26 (SELECT)

    // The page structure after login is:
    //   main page (login.aspx) -> contentframe (PolicyDetails etc.) -> #ifrmPolicy
    // We must navigate through the contentframe to reach #ifrmPolicy.

    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      return { success: false, message: "Content frame not found. Is the user logged in?" };
    }

    // Click the "Policy" tab inside the content frame to make #ifrmPolicy visible.
    // The tab links use href="#tabsPolicy" (not "#policyTab").
    // After New Client, the default active tab is "Client" (#ifrmClient).
    log("info", "Clicking Policy tab in content frame to show #ifrmPolicy");
    const policyTabLink = contentFrame.locator('a[href="#tabsPolicy"]');
    await policyTabLink.waitFor({ state: "visible", timeout: config.actionTimeout });
    await policyTabLink.click();
    await page.waitForTimeout(1500);

    // Access the Policy iframe inside the content frame
    log("info", "Accessing Policy iframe (#ifrmPolicy) inside content frame");
    const policyIframe = contentFrame.frameLocator("#ifrmPolicy");

    // Click "Policy info" sub-tab (#tabli0) inside the iframe
    log("info", "Clicking Policy Info sub-tab");
    const policyInfoTab = policyIframe.locator("#tabli0");
    await policyInfoTab.click();
    await page.waitForTimeout(500);

    // NPC Company code (#txt5)
    if (params.npcCompanyCode) {
      log("info", `Setting NPC company code: ${params.npcCompanyCode}`);
      const npcInput = policyIframe.locator("#txt5");
      await npcInput.click({ clickCount: 3 });
      await npcInput.fill(params.npcCompanyCode);
      // Tab out to trigger the lookup
      await npcInput.press("Tab");
      await page.waitForTimeout(1500);

      // The Tab triggers a #modalSearch overlay inside the iframe.
      // We must dismiss it before we can interact with other fields.
      log("info", "Checking for #modalSearch modal after NPC code lookup");
      const modalSearch = policyIframe.locator("#modalSearch.modal.fade.in, #modalSearch.in");
      const modalVisible = await modalSearch.isVisible().catch(() => false);
      if (modalVisible) {
        log("info", "modalSearch is visible, attempting to dismiss it");
        // Try clicking a close button inside the modal
        const closeBtn = policyIframe.locator('#modalSearch .close, #modalSearch button[data-dismiss="modal"], #modalSearch .btn-close');
        if (await closeBtn.first().isVisible().catch(() => false)) {
          await closeBtn.first().click();
          log("info", "Clicked modal close button");
        } else {
          // Try pressing Escape to dismiss
          await policyIframe.locator("body").press("Escape");
          log("info", "Pressed Escape to dismiss modal");
        }
        await page.waitForTimeout(1000);

        // If modal is still visible, try clicking outside it or force-hiding via JS
        const stillVisible = await modalSearch.isVisible().catch(() => false);
        if (stillVisible) {
          log("info", "Modal still visible, hiding via JavaScript");
          await policyIframe.locator("#modalSearch").evaluate((el) => {
            (el as HTMLElement).style.display = "none";
            (el as HTMLElement).classList.remove("in");
            // Also remove any backdrop
            const backdrop = document.querySelector(".modal-backdrop");
            if (backdrop) backdrop.remove();
          });
          await page.waitForTimeout(500);
        }
      }
      fieldsSet.push("npcCompanyCode");
    }

    // Payment frequency (#txt15 - SELECT)
    if (params.paymentFrequency) {
      log("info", `Setting payment frequency: ${params.paymentFrequency}`);
      const freqSelect = policyIframe.locator("#txt15");
      try {
        await freqSelect.selectOption({ label: params.paymentFrequency });
      } catch {
        // Try by value if label doesn't match
        await freqSelect.selectOption(params.paymentFrequency);
      }
      fieldsSet.push("paymentFrequency");
    }

    // Inception date (#txt17) - format DD/MM/YYYY
    // Also auto-calculate: expiry date = same DD/MM but year 2099
    // Review month = month after the expiry/inception month
    if (params.inceptionDate) {
      log("info", `Setting inception date: ${params.inceptionDate}`);
      const inceptionInput = policyIframe.locator("#txt17");
      await inceptionInput.click({ clickCount: 3 });
      await inceptionInput.fill(params.inceptionDate);
      await inceptionInput.press("Tab");
      await page.waitForTimeout(500);
      fieldsSet.push("inceptionDate");

      // Auto-calculate expiry date: same DD/MM but year 2099
      const parts = params.inceptionDate.split("/");
      if (parts.length === 3) {
        const dd = parts[0];
        const mm = parts[1];
        const expiryDate = `${dd}/${mm}/2099`;
        log("info", `Auto-setting expiry date: ${expiryDate}`);
        const expiryInput = policyIframe.locator("#txt18");
        await expiryInput.click({ clickCount: 3 });
        await expiryInput.fill(expiryDate);
        await expiryInput.press("Tab");
        await page.waitForTimeout(500);
        fieldsSet.push("expiryDate (auto: 2099)");

        // Auto-calculate review month: month AFTER the inception/expiry month
        const monthNum = parseInt(mm, 10);
        const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];
        const reviewMonthIdx = monthNum % 12; // month after (0-indexed: Jan=0, so if mm=2 (Feb), next=2 which is March)
        const reviewMonthName = monthNames[reviewMonthIdx];
        log("info", `Auto-setting review month: ${reviewMonthName} (month after ${monthNames[monthNum - 1]})`);

        // The review month SELECT (#txt26) may be disabled - enable it via JS first
        const monthSelect = policyIframe.locator("#txt26");
        await policyIframe.locator("#txt26").evaluate((el) => {
          (el as HTMLSelectElement).disabled = false;
          (el as HTMLSelectElement).removeAttribute("readonly");
          el.classList.remove("aspNetDisabled");
        });
        await page.waitForTimeout(300);

        try {
          await monthSelect.selectOption({ label: reviewMonthName });
        } catch {
          // Try by value (might be numeric)
          await monthSelect.selectOption(String(reviewMonthIdx + 1));
        }
        fieldsSet.push(`reviewMonth (auto: ${reviewMonthName})`);
      }
    } else if (params.expiryDate) {
      // If expiry date is explicitly provided
      log("info", `Setting expiry date: ${params.expiryDate}`);
      const expiryInput = policyIframe.locator("#txt18");
      await expiryInput.click({ clickCount: 3 });
      await expiryInput.fill(params.expiryDate);
      await expiryInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("expiryDate");
    }

    // Review date (#txt19) - only if explicitly provided
    if (params.reviewDate) {
      log("info", `Setting review date: ${params.reviewDate}`);
      const reviewInput = policyIframe.locator("#txt19");
      await reviewInput.click({ clickCount: 3 });
      await reviewInput.fill(params.reviewDate);
      await reviewInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("reviewDate");
    }

    // Review month (#txt26 - SELECT) - only if explicitly provided and not auto-calculated above
    if (params.reviewMonth && !params.inceptionDate) {
      log("info", `Setting review month: ${params.reviewMonth}`);
      const monthSelect = policyIframe.locator("#txt26");
      // Enable if disabled
      await policyIframe.locator("#txt26").evaluate((el) => {
        (el as HTMLSelectElement).disabled = false;
        (el as HTMLSelectElement).removeAttribute("readonly");
        el.classList.remove("aspNetDisabled");
      });
      await page.waitForTimeout(300);
      try {
        await monthSelect.selectOption({ label: params.reviewMonth });
      } catch {
        await monthSelect.selectOption(params.reviewMonth);
      }
      fieldsSet.push("reviewMonth");
    }

    log("info", `==== POLICY INFO COMPLETE ====`);
    log("info", `Policy info filled: ${fieldsSet.join(", ")}`);
    return {
      success: true,
      message: `Policy info filled. Fields set: ${fieldsSet.join(", ")}`,
      data: { fieldsSet },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `==== POLICY INFO FAILED ====`);
    log("error", `Policy info error: ${msg}`);
    log("error", `Fields set before error: ${fieldsSet.join(", ")}`);
    return { success: false, message: `Policy info error: ${msg}`, data: { fieldsSet } };
  }
}
