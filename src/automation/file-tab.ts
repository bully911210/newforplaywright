import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

/**
 * Generic helper: dismiss modals and click #btnSave inside a given iframe.
 * Works for any tab iframe (#ifrmClient, #ifrmPolicy, etc.)
 *
 * IMPORTANT: After clicking File, if the server returns validation errors
 * (e.g., "Branch code: Invalid entry, must be a numeric value"),
 * we collect ALL errors and FAIL — we do NOT silently dismiss them.
 */
export async function fileTab(iframeId: string): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();
  const validationErrors: string[] = [];

  log("info", `==== FILE TAB START: ${iframeId} ====`);

  try {
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      log("error", `fileTab(${iframeId}): Content frame not found!`);
      return { success: false, message: "Content frame not found. Is the user logged in?" };
    }

    // Determine which tab to click based on iframe ID
    const tabMap: Record<string, string> = {
      ifrmClient: "#tabsClient",
      ifrmPolicy: "#tabsPolicy",
      ifrmCover: "#tabsCover",
    };
    const tabHref = tabMap[iframeId];
    if (tabHref) {
      log("info", `Clicking tab for ${iframeId} (href="${tabHref}")`);
      const tabLink = contentFrame.locator(`a[href="${tabHref}"]`);
      await tabLink.waitFor({ state: "visible", timeout: config.actionTimeout });
      await tabLink.click();
      await page.waitForTimeout(1500);
    }

    const iframe = contentFrame.frameLocator(`#${iframeId}`);

    // Dismiss any lingering #modalMessage modals BEFORE clicking File (up to 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      const modalMsg = iframe.locator("#modalMessage.modal.fade.in, #modalMessage.in");
      if (await modalMsg.isVisible().catch(() => false)) {
        const msgText =
          (await iframe
            .locator("#modalMessage .modal-body, #modalMessage #lblMessage")
            .textContent()
            .catch(() => "")) ?? "";
        log("info", `Pre-File #modalMessage (attempt ${attempt + 1}): "${msgText.trim().substring(0, 200)}"`);
        await iframe
          .locator('#modalMessage .btn, #modalMessage button[data-dismiss="modal"]')
          .first()
          .click({ force: true })
          .catch(() => {});
        await page.waitForTimeout(1000);
      } else {
        break;
      }
    }

    // Dismiss any #modalSearch
    const modalSearch = iframe.locator("#modalSearch.modal.fade.in, #modalSearch.in");
    if (await modalSearch.isVisible().catch(() => false)) {
      log("info", "Pre-File: Dismissing #modalSearch");
      await iframe
        .locator('#modalSearch button[data-dismiss="modal"], #modalSearch .close')
        .first()
        .click({ force: true })
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    // Remove modal backdrops and hide lingering modals via JS
    await iframe
      .locator("body")
      .evaluate((body) => {
        body.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
        body.querySelectorAll(".modal.fade.in").forEach((el) => {
          (el as HTMLElement).style.display = "none";
          el.classList.remove("in");
        });
      })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Click the File button (#btnSave)
    log("info", `Clicking File button (#btnSave) inside #${iframeId}`);
    const fileBtn = iframe.locator("#btnSave");
    await fileBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await fileBtn.click();

    // Wait a reasonable time for the server response
    await page.waitForTimeout(3000);

    // Check for post-File modals — collect ALL validation errors
    for (let attempt = 0; attempt < 5; attempt++) {
      const postModal = iframe.locator("#modalMessage.modal.fade.in, #modalMessage.in");
      if (await postModal.isVisible().catch(() => false)) {
        const postText =
          (await iframe
            .locator("#modalMessage .modal-body, #modalMessage #lblMessage")
            .textContent()
            .catch(() => "")) ?? "";
        const trimmed = postText.trim().substring(0, 300);
        log("info", `Post-File modal (attempt ${attempt + 1}): "${trimmed}"`);

        // Detect VALIDATION ERRORS (not just info modals)
        const lowerText = trimmed.toLowerCase();
        const isValidationError =
          lowerText.includes("invalid") ||
          lowerText.includes("must be") ||
          lowerText.includes("required") ||
          lowerText.includes("cannot be") ||
          lowerText.includes("error") ||
          lowerText.includes("failed") ||
          lowerText.includes("critical");

        if (isValidationError) {
          log("error", `[VALIDATION ERROR] during File of ${iframeId}: "${trimmed}"`);
          validationErrors.push(trimmed);
        }

        await iframe
          .locator('#modalMessage .btn, #modalMessage button[data-dismiss="modal"]')
          .first()
          .click({ force: true })
          .catch(() => {});
        await page.waitForTimeout(1000);
      } else {
        break;
      }
    }

    // If we collected any validation errors, FAIL the step
    if (validationErrors.length > 0) {
      const errMsg = validationErrors.join("; ");
      log("error", `==== FILE TAB FAILED: ${iframeId} — validation errors: ${errMsg} ====`);
      return {
        success: false,
        message: `fileTab(${iframeId}) validation errors: ${errMsg}`,
      };
    }

    log("info", `==== FILE TAB SUCCESS: ${iframeId} ====`);
    return {
      success: true,
      message: `Tab ${iframeId} filed successfully.`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `==== FILE TAB ERROR: ${iframeId} ====`);
    log("error", `fileTab(${iframeId}) error: ${msg}`);
    return { success: false, message: `fileTab(${iframeId}) error: ${msg}` };
  }
}

/** File the Client tab (#btnSave inside #ifrmClient) */
export async function fileClientTab(): Promise<ToolResult> {
  return fileTab("ifrmClient");
}

/** File the Policy tab (#btnSave inside #ifrmPolicy) */
export async function filePolicyTab(): Promise<ToolResult> {
  return fileTab("ifrmPolicy");
}
