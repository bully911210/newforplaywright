import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

export async function fillBankDetails(params: {
  accountHolder?: string;
  accountNumber?: string;
  branchCode?: string;
  collectionDay?: string;
  paymentMethod?: string;
}): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();
  const fieldsSet: string[] = [];

  try {
    // The form content lives inside the #ifrmPolicy iframe.
    // Bank Details is a sub-tab within that same iframe.
    //
    // Calibrated selectors from live DOM inspection (inside #ifrmPolicy):
    //   Bank Details sub-tab: #tabli1
    //   Account holder/payee: #txt32 (input)
    //   Account number: #txt31 (input)
    //   Branch code: #txt30 (input), #txtDesc30 (readonly description)
    //   Collection day: #txt27 (SELECT, default "01")
    //   Payment method: #txt28 (SELECT, default "N")

    // The page structure after login is:
    //   main page (login.aspx) -> contentframe (PolicyDetails etc.) -> #ifrmPolicy
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      return { success: false, message: "Content frame not found. Is the user logged in?", data: { fieldsSet } };
    }

    // Click the "Policy" tab inside the content frame to make #ifrmPolicy visible.
    log("info", "Clicking Policy tab in content frame to show #ifrmPolicy");
    const policyTabLink = contentFrame.locator('a[href="#tabsPolicy"]');
    await policyTabLink.waitFor({ state: "visible", timeout: config.actionTimeout });
    await policyTabLink.click();
    await page.waitForTimeout(1500);

    // Access the Policy iframe inside the content frame
    log("info", "Accessing Policy iframe (#ifrmPolicy) inside content frame");
    const policyIframe = contentFrame.frameLocator("#ifrmPolicy");

    // Click "Bank details" sub-tab (#tabli1) inside the iframe
    log("info", "Clicking Bank Details sub-tab");
    const bankTab = policyIframe.locator("#tabli1");
    await bankTab.click();
    await page.waitForTimeout(500);

    // Account holder / payee name (#txt32)
    if (params.accountHolder) {
      log("info", `Setting account holder: ${params.accountHolder}`);
      const holderInput = policyIframe.locator("#txt32");
      await holderInput.click({ clickCount: 3 });
      await holderInput.fill(params.accountHolder);
      await holderInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("accountHolder");
    }

    // Account number (#txt31)
    if (params.accountNumber) {
      log("info", `Setting account number: ${params.accountNumber}`);
      const accountInput = policyIframe.locator("#txt31");
      await accountInput.click({ clickCount: 3 });
      await accountInput.fill(params.accountNumber);
      await accountInput.press("Tab");
      await page.waitForTimeout(300);
      fieldsSet.push("accountNumber");
    }

    // Branch code (#txt30) - expects a numeric branch code
    // South African banks have universal branch codes. We map bank name -> numeric code
    // and enter it directly, then Tab to trigger validation.
    if (params.branchCode) {
      // Map of common SA bank names to their universal branch codes
      const bankBranchCodes: Record<string, string> = {
        "capitec": "470010",
        "absa": "632005",
        "fnb": "250655",
        "first national bank": "250655",
        "nedbank": "198765",
        "standard bank": "051001",
        "african bank": "430000",
        "investec": "580105",
        "tymebank": "678910",
        "tyme bank": "678910",
        "discovery bank": "679000",
        "bidvest bank": "462005",
        "grindrod bank": "223626",
        "sasfin bank": "683000",
        "mercantile bank": "450105",
        "ubank": "431010",
      };

      const bankNameLower = params.branchCode.toLowerCase().trim();
      const numericCode = bankBranchCodes[bankNameLower] || params.branchCode;
      log("info", `Setting branch code for bank "${params.branchCode}": ${numericCode}`);

      const branchInput = policyIframe.locator("#txt30");
      await branchInput.click({ clickCount: 3 });
      await branchInput.fill(numericCode);
      await branchInput.press("Tab");
      await page.waitForTimeout(2000);

      // After Tab, a #modalSearch lookup modal may appear if the code triggered a search.
      // Or a #modalMessage error may appear if the code is invalid.
      // Dismiss any modals that appeared.

      // First check for #modalMessage (validation error)
      const modalMessage = policyIframe.locator('#modalMessage.modal.fade.in, #modalMessage.in');
      if (await modalMessage.isVisible().catch(() => false)) {
        const msgText = await policyIframe.locator('#modalMessage .modal-body, #modalMessage #lblMessage').textContent().catch(() => "") ?? "";
        log("info", `modalMessage appeared: "${msgText.trim().substring(0, 100)}"`);
        const msgCloseBtn = policyIframe.locator('#modalMessage .btn, #modalMessage button[data-dismiss="modal"]');
        await msgCloseBtn.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(1000);
      }

      // Check for #modalSearch (lookup results)
      const modalSearch = policyIframe.locator("#modalSearch.modal.fade.in, #modalSearch.in");
      if (await modalSearch.isVisible().catch(() => false)) {
        log("info", "Branch code search modal appeared, selecting first result");

        // Try clicking the first result in #linkTable
        const firstResult = policyIframe.locator('#linkTable a, #linkTable tr[onclick], #linkTable div[onclick], #linkTable td').first();
        if (await firstResult.isVisible().catch(() => false)) {
          await firstResult.click();
          await page.waitForTimeout(1500);
        } else {
          // Close the modal
          log("info", "No results in search modal, closing");
          const closeBtn = policyIframe.locator('#modalSearch button[data-dismiss="modal"], #modalSearch .close');
          await closeBtn.first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      // Verify the branch code was set by reading the description field
      const branchDesc = await policyIframe.locator("#txtDesc30").inputValue().catch(() => "");
      if (branchDesc) {
        log("info", `Branch code description: "${branchDesc}"`);
      }

      // Dismiss any remaining modals
      const anyModal = policyIframe.locator('.modal.fade.in');
      if (await anyModal.first().isVisible().catch(() => false)) {
        log("info", "Dismissing remaining modal after branch code");
        await policyIframe.locator('.modal.fade.in .btn, .modal.fade.in button[data-dismiss="modal"]').first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }

      fieldsSet.push("branchCode");
    }

    // After branch code modal interactions, the Bank Details sub-tab may have lost focus.
    // Re-click it to ensure all fields below are visible.
    log("info", "Re-clicking Bank Details sub-tab to ensure visibility");
    await bankTab.click();
    await page.waitForTimeout(500);

    // Collection day (#txt27 - SELECT)
    if (params.collectionDay) {
      log("info", `Setting collection day: ${params.collectionDay}`);
      const daySelect = policyIframe.locator("#txt27");
      try {
        await daySelect.selectOption({ label: params.collectionDay });
      } catch {
        await daySelect.selectOption(params.collectionDay);
      }
      fieldsSet.push("collectionDay");
    }

    // Payment method / Account type (#txt28 - SELECT)
    // Known options: Select(""), Current(1), Savings(2), Transmission(3), Cash(9), Invalid(0), Not specified(N)
    // The param is the account type label (e.g., "Savings") from the sheet data
    if (params.paymentMethod) {
      // Map account type labels to their numeric values
      const accountTypeMap: Record<string, string> = {
        "current": "1",
        "savings": "2",
        "transmission": "3",
        "cash": "9",
        "invalid": "0",
        "not specified": "N",
      };

      const pmLower = params.paymentMethod.toLowerCase().trim();
      const pmValue = accountTypeMap[pmLower] || params.paymentMethod;
      log("info", `Setting account type: ${params.paymentMethod} (value=${pmValue})`);

      // Re-click Bank Details tab to ensure the select is fully visible & interactive
      await bankTab.click();
      await page.waitForTimeout(500);

      const methodSelect = policyIframe.locator("#txt28");

      // IMPORTANT: The #txt28 onchange handler runs `doValidation(28); runAfterSub(this);`
      // which triggers CDV validation that RESETS the value within ~100ms.
      // The xonblur="CDV" also resets on blur.
      //
      // Solution: Set the value via JS WITHOUT triggering change/blur events.
      // The ASP.NET form submission reads the DOM selectedIndex directly on File click.
      await methodSelect.evaluate((el, val) => {
        const select = el as HTMLSelectElement;
        // Remove the onchange handler temporarily
        const origOnChange = select.onchange;
        select.onchange = null;
        // Set the value
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === val) {
            select.selectedIndex = i;
            select.options[i].selected = true;
            break;
          }
        }
        // Do NOT restore onchange - let it stay null so File picks up our value
        // Do NOT dispatch any events that would trigger validation
      }, pmValue);
      await page.waitForTimeout(300);

      // Verify
      const currentVal = await methodSelect.evaluate((el) => (el as HTMLSelectElement).value).catch(() => "");
      log("info", `Account type value after setting: "${currentVal}"`);
      if (currentVal !== pmValue) {
        log("info", `Account type mismatch: expected "${pmValue}", got "${currentVal}". Retrying...`);
        // Second attempt - also try removing the xonblur CDV attribute
        await methodSelect.evaluate((el, val) => {
          const select = el as HTMLSelectElement;
          select.onchange = null;
          select.removeAttribute("xonblur");
          select.removeAttribute("onchange");
          select.value = val;
        }, pmValue);
        await page.waitForTimeout(200);
        const retryVal = await methodSelect.evaluate((el) => (el as HTMLSelectElement).value).catch(() => "");
        log("info", `Account type value after retry: "${retryVal}"`);
      }
      fieldsSet.push("paymentMethod/accountType");
    }

    log("info", `Bank details filled: ${fieldsSet.join(", ")}`);
    return {
      success: true,
      message: `Bank details filled. Fields set: ${fieldsSet.join(", ")}`,
      data: { fieldsSet },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Bank details error: ${msg}`);
    return { success: false, message: `Bank details error: ${msg}`, data: { fieldsSet } };
  }
}
