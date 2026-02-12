import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

/**
 * Fill the Cover tab: click Donation row → click Add → enter amount → File.
 *
 * Prerequisites: Client tab AND Policy tab must be Filed first,
 * otherwise a "CRITICAL INPUT" modal blocks interaction.
 *
 * Cover tab structure (inside #ifrmCover):
 *   - Table #tblList with "Donation" row (id="117", onclick=getRiskItems(...))
 *   - Clicking row opens #dialogRiskItems dialog
 *   - Dialog has #addItem button to add a new item
 *   - After addItem, the iframe loads a form with fields:
 *       #txt1  (Section) = "0.00" ← readonly formula field, must set via JS
 *       #txt11 (Item) = "" ← editable, enter donation amount here
 *       #txt13 (Status SELECT) = "A" (readonly/disabled)
 *       #txt15 (Effective date) = auto-filled (readonly)
 *       #txt20 (Rating method SELECT) = "M" (readonly/disabled)
 *   - Donation amount must be entered in BOTH #txt11 (Item) AND #txt1 (Section)
 *   - #btnSave to File the cover item
 */
export async function fillCoverTab(params: {
  donationAmount: string;
  effectiveDate?: string; // DD/MM/YYYY — debit order date
}): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();

  try {
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      return { success: false, message: "Content frame not found. Is the user logged in?" };
    }

    // Click Cover tab
    log("info", "Clicking Cover tab");
    const coverTabLink = contentFrame.locator('a[href="#tabsCover"]');
    await coverTabLink.waitFor({ state: "visible", timeout: config.actionTimeout });
    await coverTabLink.click();
    await page.waitForTimeout(3000);

    const coverIframe = contentFrame.frameLocator("#ifrmCover");

    // Check for "CRITICAL INPUT" modal (means Client/Policy not filed)
    const criticalModal = coverIframe.locator("#modalMessage.in, #modalMessage.modal.fade.in");
    if (await criticalModal.isVisible().catch(() => false)) {
      const modalText = (await coverIframe
        .locator("#modalMessage .modal-body, #modalMessage #lblMessage, #modalMessage #modalHeader")
        .textContent()
        .catch(() => "")) ?? "";
      if (modalText.toUpperCase().includes("CRITICAL INPUT")) {
        return {
          success: false,
          message: `Cover tab blocked: "${modalText.trim()}". File Client and Policy tabs first.`,
        };
      }
      // Dismiss non-critical modal
      await coverIframe.locator('#modalMessage .btn').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Click the Donation row (using force:true since td click is more reliable)
    log("info", "Clicking Donation row in cover table");
    const donationTd = coverIframe.locator('td:has-text("Donation")').first();
    await donationTd.waitFor({ state: "visible", timeout: config.actionTimeout });
    await donationTd.click({ force: true });
    await page.waitForTimeout(3000);

    // Check for modal message after click (dismiss if needed)
    const postClickModal = coverIframe.locator("#modalMessage.in, #modalMessage.modal.fade.in");
    if (await postClickModal.isVisible().catch(() => false)) {
      const postText = (await coverIframe
        .locator("#modalMessage")
        .textContent()
        .catch(() => "")) ?? "";
      log("info", `Modal after Donation click: "${postText.trim().substring(0, 100)}"`);
      await coverIframe.locator('#modalMessage .btn').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Wait for #dialogRiskItems to appear
    const dialog = coverIframe.locator("#dialogRiskItems");
    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (!dialogVisible) {
      return { success: false, message: "Dialog #dialogRiskItems did not appear after clicking Donation row." };
    }
    log("info", "dialogRiskItems is visible");

    // Click #addItem button
    const addBtn = coverIframe.locator("#addItem");
    const addVisible = await addBtn.isVisible().catch(() => false);
    if (!addVisible) {
      return { success: false, message: "#addItem button not visible in the dialog." };
    }
    log("info", "Clicking #addItem button");
    await addBtn.click();
    await page.waitForTimeout(5000);

    // After addItem, the iframe navigates to a form (Screen.aspx)
    // Donation amount must go into BOTH #txt11 (Item, editable) and #txt1 (Section, readonly formula).

    // 1. Fill #txt11 (Item) - this is the editable field
    log("info", `Setting Item (#txt11) to donation amount: ${params.donationAmount}`);
    const itemField = coverIframe.locator("#txt11");
    await itemField.waitFor({ state: "visible", timeout: config.actionTimeout });
    await itemField.click({ clickCount: 3 });
    await itemField.fill(params.donationAmount);
    await itemField.press("Tab");
    await page.waitForTimeout(500);

    // 2. Fill #txt1 (Section) - readonly formula field, must use JS to set value
    log("info", `Setting Section (#txt1) to donation amount: ${params.donationAmount}`);
    const sectionField = coverIframe.locator("#txt1");
    await sectionField.evaluate((el, amount) => {
      const input = el as HTMLInputElement;
      input.removeAttribute("readonly");
      input.value = amount;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.setAttribute("readonly", "true");
    }, params.donationAmount);
    await page.waitForTimeout(500);

    // 3. Set Effective date (#txt15) to debit order date if provided
    if (params.effectiveDate) {
      log("info", `Setting Effective date (#txt15) to: ${params.effectiveDate}`);
      const effectiveField = coverIframe.locator("#txt15");
      await effectiveField.evaluate((el, dateVal) => {
        const input = el as HTMLInputElement;
        input.removeAttribute("readonly");
        input.removeAttribute("disabled");
        input.value = dateVal;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, params.effectiveDate);
      await page.waitForTimeout(500);
    }

    // Click File button (#btnSave) inside the cover item form
    log("info", "Clicking File button in Cover item form");
    const fileBtn = coverIframe.locator("#btnSave");
    await fileBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fileBtn.click();
    await page.waitForTimeout(3000);

    // Dismiss any post-File modal
    for (let attempt = 0; attempt < 3; attempt++) {
      const postFileModal = coverIframe.locator("#modalMessage.in, #modalMessage.modal.fade.in");
      if (await postFileModal.isVisible().catch(() => false)) {
        const pfText = (await coverIframe
          .locator("#modalMessage .modal-body, #modalMessage #lblMessage")
          .textContent()
          .catch(() => "")) ?? "";
        log("info", `Post-File modal (attempt ${attempt + 1}): "${pfText.trim().substring(0, 100)}"`);
        await coverIframe.locator('#modalMessage .btn').first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(1000);
      } else {
        break;
      }
    }

    log("info", `Cover tab filled and filed. Donation amount: ${params.donationAmount}`);
    return {
      success: true,
      message: `Cover tab filled. Donation amount: ${params.donationAmount}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Cover tab error: ${msg}`);
    return { success: false, message: `Cover tab error: ${msg}` };
  }
}
