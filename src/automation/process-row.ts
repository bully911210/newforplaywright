import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import { fetchClientRow, updateCell, highlightCells } from "../sheets/client.js";
import { loginToMMX } from "./login.js";
import { fillClientSearch } from "./client-search.js";
import { fillClientInfo } from "./client-info.js";
import { fillPolicyInfo } from "./policy-info.js";
import { fillBankDetails } from "./bank-details.js";
import { fileClientTab, filePolicyTab } from "./file-tab.js";
import { fillCoverTab } from "./cover-tab.js";
import { getPage, closeBrowser } from "./browser-manager.js";
import { startRun, updateRunStep, completeRun } from "../dashboard/run-history.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, "../../screenshots");

/**
 * Process a single row from the Google Sheet through the full E2E MMX flow.
 * Tracks progress in the dashboard run history and captures screenshots on failure.
 */
export async function processRow(rowNumber: number): Promise<{ success: boolean; message: string }> {
  const config = getConfig();
  const sheetUrl = config.googleSheetWebAppUrl;

  if (!sheetUrl) {
    return { success: false, message: "No Google Sheet Web App URL configured." };
  }

  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Helper: highlight columns green
  const hl = (cols: string | string[]) =>
    highlightCells(sheetUrl, rowNumber, cols, "#4CAF50").catch(() => {});

  // Helper: highlight columns red for errors
  const hlRed = (cols: string | string[]) =>
    highlightCells(sheetUrl, rowNumber, cols, "#F44336").catch(() => {});

  // Helper: highlight columns yellow for "in progress"
  const hlYellow = (cols: string | string[]) =>
    highlightCells(sheetUrl, rowNumber, cols, "#FFF176").catch(() => {});

  let step = "init";
  let run: ReturnType<typeof startRun> | null = null;

  try {
    // 1. Fetch row data
    step = "fetch_row";
    log("info", `[Row ${rowNumber}] Fetching row data...`);
    const row = await fetchClientRow(sheetUrl, rowNumber, config.columnMapping);
    const d = row.mappedData;

    // LOG ALL RAW SHEET DATA
    log("info", `[Row ${rowNumber}] ========== RAW SHEET DATA ==========`);
    for (const [key, value] of Object.entries(d)) {
      log("info", `[Row ${rowNumber}]   ${key} = "${value}"`);
    }
    log("info", `[Row ${rowNumber}] ====================================`);

    // Only process rows with status "New" (case-insensitive)
    const rowStatus = (d.status || "").trim().toLowerCase();
    if (rowStatus !== "new") {
      log("info", `[Row ${rowNumber}] Skipping - status is "${d.status}" (must be "New")`);
      return { success: false, message: `Row status is "${d.status}", expected "New"` };
    }

    // Validate required fields
    if (!d.clientName && !d.clientSurname) {
      log("info", `[Row ${rowNumber}] Skipping - no client name or surname`);
      return { success: false, message: "No client name or surname in row" };
    }

    // Start dashboard run tracking
    run = startRun({
      workflowId: "mmx",
      workflowLabel: "MMX Donation Upload",
      rowNumber,
      clientName: `${d.clientName || ""} ${d.clientSurname || ""}`.trim(),
    });

    // Mark as processing + highlight status yellow
    await updateCell(sheetUrl, rowNumber, "A", "Processing...");
    await hlYellow("A");

    // Format dates from sheet.
    // The Google Sheet API may return dates in two formats:
    //   1. DD/MM/YYYY (if Apps Script formatCellValue is working)
    //   2. JS Date string "Mon Nov 02 2026 00:00:00 GMT+0200" (if cell is a Date object)
    // formatDate() handles both correctly.
    const inceptionDate = formatDate(d.dateSaleMade);
    const debitOrderDate = formatDate(d.debitOrderDate);           // e.g. "03/01/2026"
    const collectionDay = debitOrderDate.split("/")[0] || "01";    // e.g. "03"

    log("info", `[Row ${rowNumber}] RAW dateSaleMade="${d.dateSaleMade}" → inceptionDate="${inceptionDate}"`);
    log("info", `[Row ${rowNumber}] RAW debitOrderDate="${d.debitOrderDate}" → debitOrderDate="${debitOrderDate}" → collectionDay="${collectionDay}"`);

    // 2. Login
    step = "login";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Logging in to MMX...`);
    const loginResult = await loginToMMX();
    if (!loginResult.success) throw new Error(`Login failed: ${loginResult.message}`);

    // 3. Client Search → New Client
    step = "client_search";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Client Search → New Client...`);
    const searchResult = await fillClientSearch("Domestic", "GW6 - CIV DOMESTIC DONATION NPC");
    if (!searchResult.success) throw new Error(`Client Search failed: ${searchResult.message}`);

    // 4. Fill Client tab
    // Client inception date = debit order date (when the debit starts)
    step = "client_info";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Filling Client tab (inception=${debitOrderDate})...`);
    const clientResult = await fillClientInfo({
      name: d.clientName || "",
      contactName: d.clientSurname || "",
      idNumber: d.idNumber || "",
      cellphone: d.cellphone || "",
      email: d.email || "",
      address1: d.address || "",
      address2: d.city || "",
      address3: d.province || "",
      postalCode: d.postalCode || "",
      inceptionDate: debitOrderDate,
    });
    if (!clientResult.success) throw new Error(`Client Info failed: ${clientResult.message}`);

    // 5. File Client tab
    step = "file_client";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Filing Client tab...`);
    const fileClientResult = await fileClientTab();
    if (!fileClientResult.success) throw new Error(`File Client failed: ${fileClientResult.message}`);

    await hl(["B", "C", "D", "E", "F", "G", "H", "I", "J", "R"]);

    // 6. Fill Policy Info
    // Policy inception date = debit order date (when the debit/policy starts)
    // NOT the sale date (which is when the contract was signed)
    step = "policy_info";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Filling Policy Info (inception=${debitOrderDate})...`);
    const policyResult = await fillPolicyInfo({
      npcCompanyCode: "CIV01",
      paymentFrequency: mapPaymentFrequency(d.paymentFrequency),
      inceptionDate: debitOrderDate,
    });
    if (!policyResult.success) throw new Error(`Policy Info failed: ${policyResult.message}`);

    await hl("P");

    // 7. Fill Bank Details
    step = "bank_details";
    updateRunStep(run.id, step);
    const bankParams = {
      accountHolder: d.accountHolder || `${d.clientName || ""} ${d.clientSurname || ""}`.trim(),
      accountNumber: d.accountNumber || "",
      branchCode: d.bank || "",
      collectionDay: collectionDay,
      paymentMethod: d.accountType || "Savings",
    };
    log("info", `[Row ${rowNumber}] Filling Bank Details with:`);
    log("info", `[Row ${rowNumber}]   accountHolder = "${bankParams.accountHolder}"`);
    log("info", `[Row ${rowNumber}]   accountNumber = "${bankParams.accountNumber}"`);
    log("info", `[Row ${rowNumber}]   branchCode (RAW from sheet column L "bank") = "${bankParams.branchCode}"`);
    log("info", `[Row ${rowNumber}]   collectionDay = "${bankParams.collectionDay}" (extracted from debitOrderDate="${debitOrderDate}")`);
    log("info", `[Row ${rowNumber}]   paymentMethod (RAW from sheet column N "accountType") = "${bankParams.paymentMethod}"`);
    const bankResult = await fillBankDetails(bankParams);
    if (!bankResult.success) throw new Error(`Bank Details failed: ${bankResult.message}`);

    await hl(["K", "L", "M", "N", "Q"]);

    // 8. File Policy tab
    step = "file_policy";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Filing Policy tab...`);
    const filePolicyResult = await filePolicyTab();
    if (!filePolicyResult.success) throw new Error(`File Policy failed: ${filePolicyResult.message}`);

    // 9. Fill Cover tab
    step = "cover_tab";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Filling Cover tab...`);
    const donationAmount = d.contractAmount || "50";
    // Effective date = the actual debit order date from the sheet
    const coverResult = await fillCoverTab({ donationAmount, effectiveDate: debitOrderDate });
    if (!coverResult.success) throw new Error(`Cover Tab failed: ${coverResult.message}`);

    await hl("O");

    // 10. Update sheet status to "Uploaded"
    step = "update_status";
    updateRunStep(run.id, step);
    log("info", `[Row ${rowNumber}] Updating status to "Uploaded"...`);
    await updateCell(sheetUrl, rowNumber, "A", "Uploaded");
    await hl("A");

    completeRun(run.id, { success: true });
    log("info", `[Row ${rowNumber}] Successfully processed! Closing browser...`);
    await closeBrowser();
    return { success: true, message: `Row ${rowNumber} processed successfully` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const fullError = `FAILED at ${step}: ${msg}`;
    log("error", `[Row ${rowNumber}] ${fullError}`);

    // Capture failure screenshot
    let screenshotPath: string | null = null;
    try {
      const page = await getPage();
      const filename = `fail-row${rowNumber}-${Date.now()}.png`;
      const fullPath = path.join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: fullPath, fullPage: true });
      screenshotPath = filename;
      log("info", `[Row ${rowNumber}] Failure screenshot saved: ${filename}`);
    } catch (ssErr) {
      log("warn", `[Row ${rowNumber}] Could not capture screenshot: ${ssErr}`);
    }

    // Complete dashboard run record
    if (run) {
      completeRun(run.id, { success: false, error: fullError, screenshotPath: screenshotPath ?? undefined });
    }

    // Close browser after failure
    log("info", `[Row ${rowNumber}] Closing browser after failure...`);
    await closeBrowser().catch(() => {});

    // Write error to column A and highlight it RED
    try {
      await updateCell(sheetUrl, rowNumber, "A", fullError);
      await hlRed("A");
    } catch (updateErr) {
      log("error", `[Row ${rowNumber}] Failed to write error to sheet: ${updateErr}`);
    }

    return { success: false, message: fullError };
  }
}

/**
 * Convert various date formats to DD/MM/YYYY. Falls back to today's date.
 *
 * Handles:
 *   - DD/MM/YYYY (from getDisplayValues - pass through as-is)
 *   - YYYY/MM/DD or YYYY-MM-DD (ISO-like)
 *   - JS Date strings like "Mon Nov 02 2026 00:00:00 GMT+0200"
 *   - Empty/undefined (returns today's date)
 */
function formatDate(dateStr?: string): string {
  if (!dateStr) {
    const now = new Date();
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  }

  const trimmed = dateStr.trim();

  // Already DD/MM/YYYY — pass through directly (this is the expected format from getDisplayValues)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  // YYYY-MM-DD or YYYY/MM/DD format → convert to DD/MM/YYYY
  const isoMatch = trimmed.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  // JS Date string (e.g. "Mon Nov 02 2026 00:00:00 GMT+0200")
  // Parse with new Date() — this interprets English month names correctly
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
  }

  // Fallback: return as-is and log a warning
  log("warn", `formatDate: could not parse "${dateStr}", returning as-is`);
  return trimmed;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function mapPaymentFrequency(freq?: string): string {
  if (!freq) return "Monthly";
  const lower = freq.toLowerCase().trim();
  if (lower.includes("month")) return "Monthly";
  if (lower.includes("annual") || lower.includes("year")) return "Annually";
  if (lower.includes("quarter")) return "Quarterly";
  if (lower.includes("bi")) return "Bi-Annually";
  return freq;
}
