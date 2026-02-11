import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import { fetchClientRow, updateCell } from "../sheets/client.js";
import { loginToMMX } from "./login.js";
import { fillClientSearch } from "./client-search.js";
import { fillClientInfo } from "./client-info.js";
import { fillPolicyInfo } from "./policy-info.js";
import { fillBankDetails } from "./bank-details.js";
import { fileClientTab, filePolicyTab } from "./file-tab.js";
import { fillCoverTab } from "./cover-tab.js";

/**
 * Process a single row from the Google Sheet through the full E2E MMX flow:
 *   1. Fetch row data
 *   2. Login to MMX
 *   3. Client Search → New Client
 *   4. Fill Client tab → File
 *   5. Fill Policy Info → Fill Bank Details → File Policy
 *   6. Fill Cover tab (donation) → File
 *   7. Update sheet status to "Uploaded"
 *
 * On failure, writes the error message to Column A (status).
 */
export async function processRow(rowNumber: number): Promise<{ success: boolean; message: string }> {
  const config = getConfig();
  const sheetUrl = config.googleSheetWebAppUrl;

  if (!sheetUrl) {
    return { success: false, message: "No Google Sheet Web App URL configured." };
  }

  let step = "init";

  try {
    // 1. Fetch row data
    step = "fetch_row";
    log("info", `[Row ${rowNumber}] Fetching row data...`);
    const row = await fetchClientRow(sheetUrl, rowNumber, config.columnMapping);
    const d = row.mappedData;

    // Validate required fields
    if (!d.clientName && !d.clientSurname) {
      log("info", `[Row ${rowNumber}] Skipping - no client name or surname`);
      return { success: false, message: "No client name or surname in row" };
    }

    // Mark as processing
    await updateCell(sheetUrl, rowNumber, "A", "Processing...");

    // Format inception date from dateSaleMade (DD/MM/YYYY)
    const inceptionDate = formatDate(d.dateSaleMade);
    const collectionDay = d.debitOrderDate ? padDay(d.debitOrderDate) : "01";

    // 2. Login
    step = "login";
    log("info", `[Row ${rowNumber}] Logging in to MMX...`);
    const loginResult = await loginToMMX();
    if (!loginResult.success) throw new Error(`Login failed: ${loginResult.message}`);

    // 3. Client Search → New Client
    step = "client_search";
    log("info", `[Row ${rowNumber}] Client Search → New Client...`);
    const searchResult = await fillClientSearch("Domestic", "GW6 - CIV DOMESTIC DONATION NPC");
    if (!searchResult.success) throw new Error(`Client Search failed: ${searchResult.message}`);

    // 4. Fill Client tab
    step = "client_info";
    log("info", `[Row ${rowNumber}] Filling Client tab...`);
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
      inceptionDate: inceptionDate,
    });
    if (!clientResult.success) throw new Error(`Client Info failed: ${clientResult.message}`);

    // 5. File Client tab
    step = "file_client";
    log("info", `[Row ${rowNumber}] Filing Client tab...`);
    const fileClientResult = await fileClientTab();
    if (!fileClientResult.success) throw new Error(`File Client failed: ${fileClientResult.message}`);

    // 6. Fill Policy Info
    step = "policy_info";
    log("info", `[Row ${rowNumber}] Filling Policy Info...`);
    const policyResult = await fillPolicyInfo({
      npcCompanyCode: "CIV01",
      paymentFrequency: mapPaymentFrequency(d.paymentFrequency),
      inceptionDate: inceptionDate,
    });
    if (!policyResult.success) throw new Error(`Policy Info failed: ${policyResult.message}`);

    // 7. Fill Bank Details
    step = "bank_details";
    log("info", `[Row ${rowNumber}] Filling Bank Details...`);
    const bankResult = await fillBankDetails({
      accountHolder: d.accountHolder || `${d.clientName || ""} ${d.clientSurname || ""}`.trim(),
      accountNumber: d.accountNumber || "",
      branchCode: d.bank || "",
      collectionDay: collectionDay,
      paymentMethod: d.accountType || "Savings",
    });
    if (!bankResult.success) throw new Error(`Bank Details failed: ${bankResult.message}`);

    // 8. File Policy tab
    step = "file_policy";
    log("info", `[Row ${rowNumber}] Filing Policy tab...`);
    const filePolicyResult = await filePolicyTab();
    if (!filePolicyResult.success) throw new Error(`File Policy failed: ${filePolicyResult.message}`);

    // 9. Fill Cover tab
    step = "cover_tab";
    log("info", `[Row ${rowNumber}] Filling Cover tab...`);
    const donationAmount = d.contractAmount || "50";
    const coverResult = await fillCoverTab({ donationAmount });
    if (!coverResult.success) throw new Error(`Cover Tab failed: ${coverResult.message}`);

    // 10. Update sheet status to "Uploaded"
    step = "update_status";
    log("info", `[Row ${rowNumber}] Updating status to "Uploaded"...`);
    await updateCell(sheetUrl, rowNumber, "A", "Uploaded");

    log("info", `[Row ${rowNumber}] Successfully processed!`);
    return { success: true, message: `Row ${rowNumber} processed successfully` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const fullError = `FAILED at ${step}: ${msg}`;
    log("error", `[Row ${rowNumber}] ${fullError}`);

    // Write error to column A
    try {
      await updateCell(sheetUrl, rowNumber, "A", fullError);
    } catch (updateErr) {
      log("error", `[Row ${rowNumber}] Failed to write error to sheet: ${updateErr}`);
    }

    return { success: false, message: fullError };
  }
}

/** Convert various date formats to DD/MM/YYYY. Falls back to today's date. */
function formatDate(dateStr?: string): string {
  if (!dateStr) {
    const now = new Date();
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  }

  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;

  // Try parsing as a date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
  }

  // Return as-is if we can't parse
  return dateStr;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function padDay(day: string): string {
  const num = parseInt(day, 10);
  if (isNaN(num)) return "01";
  return num.toString().padStart(2, "0");
}

/** Map sheet payment frequency values to the MMX dropdown label */
function mapPaymentFrequency(freq?: string): string {
  if (!freq) return "Monthly";
  const lower = freq.toLowerCase().trim();
  if (lower.includes("month")) return "Monthly";
  if (lower.includes("annual") || lower.includes("year")) return "Annually";
  if (lower.includes("quarter")) return "Quarterly";
  if (lower.includes("bi")) return "Bi-Annually";
  return freq; // Return as-is for the dropdown to try
}
