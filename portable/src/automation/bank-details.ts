import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

/**
 * Comprehensive South African bank name -> universal branch code mapping.
 * Covers all major banks plus common misspellings, abbreviations, and aliases.
 * These are the universal/electronic branch codes used across all branches.
 */
const BANK_BRANCH_CODES: Record<string, string> = {
  // ABSA
  "absa": "632005",
  "absa bank": "632005",
  "absa bank limited": "632005",
  "absa bank ltd": "632005",
  "absa group": "632005",

  // Capitec
  "capitec": "470010",
  "capitec bank": "470010",
  "capitec bank limited": "470010",
  "capitec bank ltd": "470010",

  // FNB / First National Bank
  "fnb": "250655",
  "first national bank": "250655",
  "first national": "250655",
  "fnb bank": "250655",
  "first national bank limited": "250655",

  // Nedbank
  "nedbank": "198765",
  "nedbank limited": "198765",
  "nedbank ltd": "198765",
  "ned bank": "198765",

  // Standard Bank
  "standard bank": "051001",
  "standard bank of south africa": "051001",
  "standard bank limited": "051001",
  "standard bank ltd": "051001",
  "standard bank of sa": "051001",
  "sbsa": "051001",
  "stanbic": "051001",

  // Investec
  "investec": "580105",
  "investec bank": "580105",
  "investec bank limited": "580105",
  "investec bank ltd": "580105",
  "investec private bank": "580105",

  // African Bank
  "african bank": "430000",
  "african bank limited": "430000",
  "african bank ltd": "430000",

  // TymeBank
  "tymebank": "678910",
  "tyme bank": "678910",
  "tyme": "678910",

  // Discovery Bank
  "discovery bank": "679000",
  "discovery": "679000",
  "discovery bank limited": "679000",

  // Bank Zero
  "bank zero": "888000",
  "bankzero": "888000",
  "bank zero limited": "888000",

  // Bidvest Bank
  "bidvest bank": "462005",
  "bidvest": "462005",
  "bidvest bank limited": "462005",

  // Grindrod Bank
  "grindrod bank": "223626",
  "grindrod": "223626",
  "grindrod bank limited": "223626",

  // Sasfin Bank
  "sasfin": "683000",
  "sasfin bank": "683000",
  "sasfin bank limited": "683000",

  // Mercantile Bank
  "mercantile bank": "450905",
  "mercantile": "450905",

  // Old Mutual / OM
  "old mutual": "462005",

  // SA Post Office (Postbank)
  "postbank": "460005",
  "post bank": "460005",
  "sa post office": "460005",
  "sapo": "460005",

  // Ubank
  "ubank": "431010",
  "ubank limited": "431010",

  // Access Bank
  "access bank": "410506",
  "access bank sa": "410506",

  // Albaraka Bank
  "albaraka bank": "800000",
  "albaraka": "800000",
  "al baraka": "800000",

  // HBZ Bank
  "hbz bank": "570100",
  "hbz": "570100",
  "habib bank zurich": "570100",

  // HSBC
  "hsbc": "587000",
  "hsbc bank": "587000",

  // JPMorgan
  "jpmorgan": "432000",
  "jp morgan": "432000",

  // Citibank
  "citibank": "350005",
  "citi bank": "350005",
  "citibank na": "350005",

  // Bank of China
  "bank of china": "686000",

  // Standard Chartered
  "standard chartered": "730020",
  "standard chartered bank": "730020",

  // Wizzit / Bank of Athens (historical)
  "wizzit": "460005",
  "bank of athens": "410506",
};

/**
 * Levenshtein distance between two strings (edit distance).
 * Used for fuzzy matching bank names with typos.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Core bank keywords for deduplication during fuzzy matching.
 */
const CANONICAL_BANK_NAMES: Array<{ name: string; code: string }> = [
  { name: "absa", code: "632005" },
  { name: "absa bank", code: "632005" },
  { name: "capitec", code: "470010" },
  { name: "capitec bank", code: "470010" },
  { name: "fnb", code: "250655" },
  { name: "first national bank", code: "250655" },
  { name: "nedbank", code: "198765" },
  { name: "standard bank", code: "051001" },
  { name: "sbsa", code: "051001" },
  { name: "investec", code: "580105" },
  { name: "african bank", code: "430000" },
  { name: "tymebank", code: "678910" },
  { name: "tyme bank", code: "678910" },
  { name: "discovery bank", code: "679000" },
  { name: "bank zero", code: "888000" },
  { name: "bidvest bank", code: "462005" },
  { name: "grindrod bank", code: "223626" },
  { name: "sasfin bank", code: "683000" },
  { name: "mercantile bank", code: "450905" },
  { name: "old mutual", code: "462005" },
  { name: "postbank", code: "460005" },
  { name: "ubank", code: "431010" },
  { name: "access bank", code: "410506" },
  { name: "albaraka bank", code: "800000" },
  { name: "hbz bank", code: "570100" },
  { name: "hsbc", code: "587000" },
  { name: "jpmorgan", code: "432000" },
  { name: "citibank", code: "350005" },
  { name: "bank of china", code: "686000" },
  { name: "standard chartered", code: "730020" },
];

/**
 * Look up the universal branch code for a given bank name.
 * Uses multiple strategies:
 *   1. Exact match (case-insensitive)
 *   2. Already a numeric branch code -> pass through
 *   3. Substring/contains match
 *   4. Strip common suffixes and retry
 *   5. Levenshtein fuzzy match
 *
 * NEVER returns the bank name as a code. Returns { code: "", matched: false } if nothing matches.
 */
function lookupBranchCode(bankName: string): { code: string; matched: boolean; strategy: string } {
  if (!bankName || !bankName.trim()) {
    log("warn", `lookupBranchCode: empty bank name provided`);
    return { code: "", matched: false, strategy: "empty_input" };
  }

  const normalized = bankName.toLowerCase().trim();
  log("info", `lookupBranchCode: input="${bankName}", normalized="${normalized}"`);

  // Strategy 1: Direct exact lookup
  if (BANK_BRANCH_CODES[normalized]) {
    const code = BANK_BRANCH_CODES[normalized];
    log("info", `lookupBranchCode: EXACT MATCH "${normalized}" -> "${code}"`);
    return { code, matched: true, strategy: "exact" };
  }

  // Strategy 2: Already a numeric branch code (5-6 digits), use directly
  if (/^\d{5,6}$/.test(normalized)) {
    log("info", `lookupBranchCode: NUMERIC PASSTHROUGH "${normalized}"`);
    return { code: normalized, matched: true, strategy: "numeric_passthrough" };
  }

  // Strategy 3: Substring/contains match
  for (const [key, code] of Object.entries(BANK_BRANCH_CODES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      log("info", `lookupBranchCode: SUBSTRING MATCH "${normalized}" <-> "${key}" -> "${code}"`);
      return { code, matched: true, strategy: `substring:${key}` };
    }
  }

  // Strategy 4: Strip common suffixes and try again
  const stripped = normalized
    .replace(/\b(bank|limited|ltd|of south africa|of sa|sa|group|pty)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  log("info", `lookupBranchCode: stripped="${stripped}" (from "${normalized}")`);

  if (stripped && BANK_BRANCH_CODES[stripped]) {
    const code = BANK_BRANCH_CODES[stripped];
    log("info", `lookupBranchCode: STRIPPED EXACT "${stripped}" -> "${code}"`);
    return { code, matched: true, strategy: `stripped_exact:${stripped}` };
  }
  for (const [key, code] of Object.entries(BANK_BRANCH_CODES)) {
    if (stripped && (stripped.includes(key) || key.includes(stripped))) {
      log("info", `lookupBranchCode: STRIPPED SUBSTRING "${stripped}" <-> "${key}" -> "${code}"`);
      return { code, matched: true, strategy: `stripped_substring:${key}` };
    }
  }

  // Strategy 5: Levenshtein fuzzy match against canonical names
  let bestMatch: { name: string; code: string; dist: number } | null = null;
  for (const entry of CANONICAL_BANK_NAMES) {
    const dist = levenshtein(normalized, entry.name);
    const maxAllowed = entry.name.length <= 5 ? 1 : entry.name.length <= 10 ? 2 : 3;
    if (dist <= maxAllowed && (!bestMatch || dist < bestMatch.dist)) {
      bestMatch = { ...entry, dist };
    }
  }

  // Also fuzzy-match the stripped version
  if (stripped && stripped !== normalized) {
    for (const entry of CANONICAL_BANK_NAMES) {
      const dist = levenshtein(stripped, entry.name);
      const maxAllowed = entry.name.length <= 5 ? 1 : entry.name.length <= 10 ? 2 : 3;
      if (dist <= maxAllowed && (!bestMatch || dist < bestMatch.dist)) {
        bestMatch = { ...entry, dist };
      }
    }
  }

  if (bestMatch) {
    log("info", `lookupBranchCode: FUZZY MATCH "${bankName}" -> "${bestMatch.name}" (dist=${bestMatch.dist}) -> "${bestMatch.code}"`);
    return { code: bestMatch.code, matched: true, strategy: `fuzzy:${bestMatch.name}:dist=${bestMatch.dist}` };
  }

  log("error", `lookupBranchCode: NO MATCH for bank "${bankName}". Normalized="${normalized}", stripped="${stripped}". Will leave field empty.`);
  return { code: "", matched: false, strategy: "no_match" };
}

export async function fillBankDetails(params: {
  accountHolder?: string;
  accountNumber?: string;
  branchCode?: string;  // This receives the BANK NAME from the sheet (e.g., "Capitec", "Standard Bank")
  collectionDay?: string;
  paymentMethod?: string;
}): Promise<ToolResult> {
  const config = getConfig();
  const page = await getPage();
  const fieldsSet: string[] = [];
  const diagnostics: Record<string, string> = {};

  // LOG ALL RAW INPUT PARAMS
  log("info", `==== BANK DETAILS START ====`);
  log("info", `RAW PARAMS: accountHolder="${params.accountHolder}", accountNumber="${params.accountNumber}", branchCode(bankName)="${params.branchCode}", collectionDay="${params.collectionDay}", paymentMethod(accountType)="${params.paymentMethod}"`);

  try {
    const contentFrame = page.frame({ name: "contentframe" });
    if (!contentFrame) {
      log("error", "BANK DETAILS: Content frame not found!");
      return { success: false, message: "Content frame not found. Is the user logged in?", data: { fieldsSet, diagnostics } };
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

    // ==================== ACCOUNT HOLDER (#txt32) ====================
    if (params.accountHolder) {
      log("info", `[FIELD] Account holder: filling #txt32 with "${params.accountHolder}"`);
      const holderInput = policyIframe.locator("#txt32");
      await holderInput.click({ clickCount: 3 });
      await holderInput.fill(params.accountHolder);
      await holderInput.press("Tab");
      await page.waitForTimeout(300);

      // VERIFY
      const actualVal = await holderInput.inputValue().catch(() => "ERROR_READING");
      diagnostics.accountHolder = actualVal;
      log("info", `[VERIFY] Account holder: expected="${params.accountHolder}", actual="${actualVal}"`);
      if (actualVal !== params.accountHolder) {
        log("warn", `[MISMATCH] Account holder value doesn't match! Expected="${params.accountHolder}", Got="${actualVal}"`);
      }
      fieldsSet.push("accountHolder");
    }

    // ==================== ACCOUNT NUMBER (#txt31) ====================
    if (params.accountNumber) {
      log("info", `[FIELD] Account number: filling #txt31 with "${params.accountNumber}"`);
      const accountInput = policyIframe.locator("#txt31");
      await accountInput.click({ clickCount: 3 });
      await accountInput.fill(params.accountNumber);
      await accountInput.press("Tab");
      await page.waitForTimeout(300);

      // VERIFY
      const actualVal = await accountInput.inputValue().catch(() => "ERROR_READING");
      diagnostics.accountNumber = actualVal;
      log("info", `[VERIFY] Account number: expected="${params.accountNumber}", actual="${actualVal}"`);
      if (actualVal !== params.accountNumber) {
        log("warn", `[MISMATCH] Account number value doesn't match! Expected="${params.accountNumber}", Got="${actualVal}"`);
      }
      fieldsSet.push("accountNumber");
    }

    // ==================== BRANCH CODE (#txt30) ====================
    // The sheet gives us a BANK NAME (e.g., "Capitec", "Standard Bank", "First National Bank").
    // We MUST convert it to a NUMERIC branch code (e.g., "470010", "051001", "250655").
    // NEVER EVER type a bank name into #txt30 — it only accepts numbers.
    if (params.branchCode) {
      log("info", `[FIELD] Branch code: raw input from sheet = "${params.branchCode}"`);

      // SAFETY CHECK: Is this already numeric? Or is it a bank name?
      const isNumeric = /^\d+$/.test(params.branchCode.trim());
      log("info", `[FIELD] Branch code: isNumeric=${isNumeric}`);

      const { code: numericBranchCode, matched, strategy } = lookupBranchCode(params.branchCode);
      log("info", `[FIELD] Branch code lookup result: matched=${matched}, code="${numericBranchCode}", strategy="${strategy}"`);

      // SAFETY: Verify the result is actually numeric
      const resultIsNumeric = /^\d+$/.test(numericBranchCode);
      if (numericBranchCode && !resultIsNumeric) {
        log("error", `[SAFETY] Branch code lookup returned NON-NUMERIC value "${numericBranchCode}" for bank "${params.branchCode}"! THIS IS A BUG — refusing to type it.`);
        diagnostics.branchCode = `BUG: non-numeric "${numericBranchCode}"`;
        return {
          success: false,
          message: `FATAL: Branch code lookup returned non-numeric value "${numericBranchCode}" for bank "${params.branchCode}". This is a bug.`,
          data: { fieldsSet, diagnostics },
        };
      }

      const branchInput = policyIframe.locator("#txt30");

      if (!matched || !numericBranchCode) {
        log("error", `[FIELD] UNKNOWN BANK: "${params.branchCode}" — no branch code found. Leaving #txt30 EMPTY.`);
        diagnostics.branchCode = `UNKNOWN_BANK:${params.branchCode}`;
        // Clear the field but don't type anything
        await branchInput.click({ clickCount: 3 });
        await branchInput.fill("");
        await page.waitForTimeout(300);
      } else {
        log("info", `[FIELD] Branch code: will type NUMERIC code "${numericBranchCode}" into #txt30 (bank="${params.branchCode}")`);

        // Clear and type the NUMERIC branch code
        await branchInput.click();
        await page.waitForTimeout(300);
        await branchInput.click({ clickCount: 3 });
        await branchInput.fill(numericBranchCode);
        await page.waitForTimeout(500);

        // VERIFY before Tab — make sure the field actually has the numeric code
        const preTabVal = await branchInput.inputValue().catch(() => "ERROR_READING");
        log("info", `[VERIFY] Branch code BEFORE Tab: expected="${numericBranchCode}", actual="${preTabVal}"`);
        if (preTabVal !== numericBranchCode) {
          log("error", `[MISMATCH] Branch code field has "${preTabVal}" instead of "${numericBranchCode}"! Something overwrote it.`);
        }

        // Tab out to trigger the lookup/validation
        await branchInput.press("Tab");
        await page.waitForTimeout(3000);

        // Check for #modalMessage (validation error) and handle
        const modalMessage = policyIframe.locator('#modalMessage.modal.fade.in, #modalMessage.in');
        if (await modalMessage.isVisible().catch(() => false)) {
          const msgText = await policyIframe.locator('#modalMessage .modal-body, #modalMessage #lblMessage').textContent().catch(() => "") ?? "";
          const trimmedMsg = msgText.trim().substring(0, 200);
          log("warn", `[MODAL] Branch code validation modal: "${trimmedMsg}"`);

          // Check if it's an "Invalid entry" error
          if (trimmedMsg.toLowerCase().includes("invalid") || trimmedMsg.toLowerCase().includes("must be a numeric")) {
            log("error", `[MODAL] VALIDATION ERROR on branch code! Message: "${trimmedMsg}". Code used: "${numericBranchCode}"`);
            diagnostics.branchCode = `VALIDATION_ERROR:${trimmedMsg}`;
          }

          const msgCloseBtn = policyIframe.locator('#modalMessage .btn, #modalMessage button[data-dismiss="modal"]');
          await msgCloseBtn.first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(1000);
        }

        // Check for #modalSearch (lookup results) — click first result to confirm
        const modalSearch = policyIframe.locator("#modalSearch.modal.fade.in, #modalSearch.in");
        if (await modalSearch.isVisible().catch(() => false)) {
          log("info", "[MODAL] Branch code search modal appeared, selecting first result");

          const firstResult = policyIframe.locator('#linkTable a, #linkTable tr[onclick], #linkTable td a, #linkTable tr td').first();
          if (await firstResult.isVisible().catch(() => false)) {
            await firstResult.click();
            log("info", "[MODAL] Clicked first search result");
            await page.waitForTimeout(2000);
          } else {
            log("warn", "[MODAL] No results in search modal, closing");
            const closeBtn = policyIframe.locator('#modalSearch button[data-dismiss="modal"], #modalSearch .close, #modalSearch .btn');
            await closeBtn.first().click({ force: true }).catch(() => {});
            await page.waitForTimeout(500);
          }
        } else {
          log("info", "[MODAL] No search modal appeared — branch code auto-resolved");
        }
      }

      // FINAL VERIFICATION: Read both the code field and the description field
      const finalBranchVal = await branchInput.inputValue().catch(() => "ERROR_READING");
      const branchDesc = await policyIframe.locator("#txtDesc30").inputValue().catch(() => "ERROR_READING");
      diagnostics.branchCodeFinal = finalBranchVal;
      diagnostics.branchDesc = branchDesc;
      log("info", `[VERIFY] Branch code FINAL: value="${finalBranchVal}", description="${branchDesc}"`);

      if (!branchDesc || branchDesc === "ERROR_READING") {
        log("warn", `[VERIFY] Branch code description is EMPTY — the branch code "${finalBranchVal}" may not have been accepted by MMX`);
      }

      // Dismiss any remaining modals
      const anyModal = policyIframe.locator('.modal.fade.in');
      if (await anyModal.first().isVisible().catch(() => false)) {
        log("info", "[MODAL] Dismissing remaining modal after branch code");
        await policyIframe.locator('.modal.fade.in .btn, .modal.fade.in button[data-dismiss="modal"]').first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }

      fieldsSet.push("branchCode");
    }

    // Re-click Bank Details sub-tab to ensure visibility for remaining fields
    log("info", "Re-clicking Bank Details sub-tab to ensure visibility");
    await bankTab.click();
    await page.waitForTimeout(500);

    // ==================== COLLECTION DAY (#txt27 - SELECT) ====================
    if (params.collectionDay) {
      log("info", `[FIELD] Collection day: setting #txt27 to "${params.collectionDay}"`);
      const daySelect = policyIframe.locator("#txt27");

      // Log available options
      const dayOptions = await daySelect.evaluate((el) => {
        const select = el as HTMLSelectElement;
        return Array.from(select.options).map(o => `${o.value}="${o.text}"`).join(", ");
      }).catch(() => "ERROR_READING");
      log("info", `[FIELD] Collection day available options: [${dayOptions}]`);

      try {
        await daySelect.selectOption({ label: params.collectionDay });
      } catch {
        log("info", `[FIELD] Collection day: label match failed, trying value match`);
        await daySelect.selectOption(params.collectionDay);
      }

      // VERIFY
      const actualDay = await daySelect.evaluate((el) => (el as HTMLSelectElement).value).catch(() => "ERROR_READING");
      diagnostics.collectionDay = actualDay;
      log("info", `[VERIFY] Collection day: expected="${params.collectionDay}", actual="${actualDay}"`);
      fieldsSet.push("collectionDay");
    }

    // ==================== ACCOUNT TYPE / PAYMENT METHOD (#txt28 - SELECT) ====================
    if (params.paymentMethod) {
      log("info", `[FIELD] Account type: raw input = "${params.paymentMethod}"`);

      // Map account type labels to their numeric values
      const accountTypeMap: Record<string, string> = {
        // Current account
        "current": "1", "current account": "1", "cheque": "1", "cheque account": "1",
        "check": "1", "check account": "1", "lopende": "1", "lopende rekening": "1", "1": "1",
        // Savings account
        "savings": "2", "savings account": "2", "saving": "2", "save": "2",
        "spaar": "2", "spaarrekening": "2", "2": "2",
        // Transmission account
        "transmission": "3", "transmission account": "3", "3": "3",
        // Cash
        "cash": "9", "9": "9",
        // Invalid
        "invalid": "0", "0": "0",
        // Not specified
        "not specified": "N", "n/a": "N", "na": "N", "none": "N", "n": "N", "": "N",
      };

      const pmLower = params.paymentMethod.toLowerCase().trim();
      const pmValue = accountTypeMap[pmLower];
      if (!pmValue) {
        log("warn", `[FIELD] Account type: UNKNOWN input "${params.paymentMethod}" (lowercase="${pmLower}") — defaulting to Savings (2)`);
      } else {
        log("info", `[FIELD] Account type: "${params.paymentMethod}" -> mapped value="${pmValue}"`);
      }
      const finalPmValue = pmValue || "2"; // Default to Savings if unknown
      diagnostics.accountTypeInput = params.paymentMethod;
      diagnostics.accountTypeMapped = finalPmValue;

      // Re-click Bank Details tab to ensure the select is visible
      await bankTab.click();
      await page.waitForTimeout(500);

      const methodSelect = policyIframe.locator("#txt28");

      // Log available options BEFORE attempting to set
      const availableOptions = await methodSelect.evaluate((el) => {
        const select = el as HTMLSelectElement;
        return Array.from(select.options).map(o => `value="${o.value}" text="${o.text}" selected=${o.selected}`).join(" | ");
      }).catch(() => "ERROR_READING");
      log("info", `[FIELD] Account type #txt28 available options: [${availableOptions}]`);

      const currentValBefore = await methodSelect.evaluate((el) => (el as HTMLSelectElement).value).catch(() => "ERROR_READING");
      log("info", `[FIELD] Account type #txt28 current value BEFORE set: "${currentValBefore}"`);

      // Set the value via JS WITHOUT triggering change/blur events (CDV validation resets it)
      await methodSelect.evaluate((el, val) => {
        const select = el as HTMLSelectElement;
        // Remove ALL event handlers that might reset the value
        select.onchange = null;
        select.onblur = null;
        select.removeAttribute("onchange");
        select.removeAttribute("xonblur");
        select.removeAttribute("onblur");

        // Try to find and select the matching option
        let found = false;
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === val) {
            select.selectedIndex = i;
            select.options[i].selected = true;
            found = true;
            break;
          }
        }

        if (!found) {
          // Try matching by text content
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].text.trim().toLowerCase().includes(val.toLowerCase())) {
              select.selectedIndex = i;
              select.options[i].selected = true;
              found = true;
              break;
            }
          }
        }

        // Return diagnostic info
        return {
          found,
          selectedIndex: select.selectedIndex,
          selectedValue: select.value,
          selectedText: select.options[select.selectedIndex]?.text || "N/A",
        };
      }, finalPmValue).then((result) => {
        log("info", `[FIELD] Account type JS evaluate result: ${JSON.stringify(result)}`);
      }).catch((err) => {
        log("error", `[FIELD] Account type JS evaluate FAILED: ${err}`);
      });

      await page.waitForTimeout(300);

      // VERIFY after set
      const afterSetVal = await methodSelect.evaluate((el) => {
        const s = el as HTMLSelectElement;
        return { value: s.value, selectedIndex: s.selectedIndex, text: s.options[s.selectedIndex]?.text || "N/A" };
      }).catch(() => ({ value: "ERROR", selectedIndex: -1, text: "ERROR" }));
      diagnostics.accountTypeAfterSet = JSON.stringify(afterSetVal);
      log("info", `[VERIFY] Account type AFTER set: value="${afterSetVal.value}", index=${afterSetVal.selectedIndex}, text="${afterSetVal.text}"`);

      if (afterSetVal.value !== finalPmValue) {
        log("warn", `[MISMATCH] Account type: expected="${finalPmValue}", got="${afterSetVal.value}". Retrying with force...`);

        // Second attempt — also try via selectedIndex directly
        await methodSelect.evaluate((el, val) => {
          const select = el as HTMLSelectElement;
          select.onchange = null;
          select.onblur = null;
          select.removeAttribute("onchange");
          select.removeAttribute("xonblur");
          select.removeAttribute("onblur");

          // Force by value
          select.value = val;

          // Also force by iterating options
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === val) {
              select.selectedIndex = i;
              break;
            }
          }
        }, finalPmValue);
        await page.waitForTimeout(300);

        // VERIFY again
        const retryVal = await methodSelect.evaluate((el) => (el as HTMLSelectElement).value).catch(() => "ERROR");
        diagnostics.accountTypeAfterRetry = retryVal;
        log("info", `[VERIFY] Account type AFTER retry: value="${retryVal}"`);

        if (retryVal !== finalPmValue) {
          log("error", `[FAILED] Account type could not be set! Expected="${finalPmValue}", got="${retryVal}". The field may be locked or options don't include value "${finalPmValue}".`);
        }
      }

      fieldsSet.push("paymentMethod/accountType");
    }

    log("info", `==== BANK DETAILS COMPLETE ====`);
    log("info", `Fields set: ${fieldsSet.join(", ")}`);
    log("info", `Diagnostics: ${JSON.stringify(diagnostics)}`);
    return {
      success: true,
      message: `Bank details filled. Fields set: ${fieldsSet.join(", ")}`,
      data: { fieldsSet, diagnostics },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `==== BANK DETAILS FAILED ====`);
    log("error", `Bank details error: ${msg}`);
    log("error", `Fields set before error: ${fieldsSet.join(", ")}`);
    log("error", `Diagnostics at failure: ${JSON.stringify(diagnostics)}`);
    return { success: false, message: `Bank details error: ${msg}`, data: { fieldsSet, diagnostics } };
  }
}
