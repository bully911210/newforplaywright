import { getPage } from "./browser-manager.js";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import type { ToolResult } from "../types.js";

/**
 * Comprehensive South African bank name → universal branch code mapping.
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
 * We only fuzzy-match against the shortest/canonical name for each bank
 * to avoid false positives (e.g., "standard bank" fuzzy-matching "standard chartered").
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
 *   2. Already a numeric branch code → pass through
 *   3. Substring/contains match
 *   4. Levenshtein fuzzy match (catches typos like "Capitek", "Standar Bank", "Nedbenk")
 * Falls back to the raw input if nothing matches.
 */
function lookupBranchCode(bankName: string): { code: string; matched: boolean } {
  const normalized = bankName.toLowerCase().trim();

  // Strategy 1: Direct exact lookup
  if (BANK_BRANCH_CODES[normalized]) {
    return { code: BANK_BRANCH_CODES[normalized], matched: true };
  }

  // Strategy 2: Already a numeric branch code (5-6 digits), use directly
  if (/^\d{5,6}$/.test(normalized)) {
    return { code: normalized, matched: true };
  }

  // Strategy 3: Substring/contains match (e.g., "Standard Bank Ltd." contains "standard bank")
  for (const [key, code] of Object.entries(BANK_BRANCH_CODES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { code, matched: true };
    }
  }

  // Strategy 4: Strip common suffixes and try again
  const stripped = normalized
    .replace(/\b(bank|limited|ltd|of south africa|of sa|sa|group|pty)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && BANK_BRANCH_CODES[stripped]) {
    return { code: BANK_BRANCH_CODES[stripped], matched: true };
  }
  for (const [key, code] of Object.entries(BANK_BRANCH_CODES)) {
    if (stripped && (stripped.includes(key) || key.includes(stripped))) {
      return { code, matched: true };
    }
  }

  // Strategy 5: Levenshtein fuzzy match against canonical names
  // Allow up to 2 edits for short names, 3 for longer names
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
    log("info", `Fuzzy matched bank "${bankName}" → "${bestMatch.name}" (distance=${bestMatch.dist})`);
    return { code: bestMatch.code, matched: true };
  }

  log("warn", `No branch code mapping found for bank "${bankName}" — passing raw value`);
  return { code: bankName, matched: false };
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

    // Branch code (#txt30) — The sheet gives us a BANK NAME (e.g., "Capitec", "Standard Bank").
    // We look up the universal branch code from our hardcoded mapping, then type the NUMERIC
    // code into #txt30 and Tab to trigger the lookup. This is far more reliable than typing
    // the bank name, which often fails in the search modal.
    if (params.branchCode) {
      const { code: numericBranchCode, matched } = lookupBranchCode(params.branchCode);
      log("info", `Setting branch code for bank "${params.branchCode}": ${numericBranchCode} (mapped=${matched})`);

      const branchInput = policyIframe.locator("#txt30");

      // Click the field, clear it, type the NUMERIC branch code
      await branchInput.click();
      await page.waitForTimeout(300);
      await branchInput.click({ clickCount: 3 });
      await branchInput.fill(numericBranchCode);
      await page.waitForTimeout(500);

      // Tab out to trigger the lookup/validation
      await branchInput.press("Tab");
      await page.waitForTimeout(3000);

      // First check for #modalMessage (validation error) and dismiss
      const modalMessage = policyIframe.locator('#modalMessage.modal.fade.in, #modalMessage.in');
      if (await modalMessage.isVisible().catch(() => false)) {
        const msgText = await policyIframe.locator('#modalMessage .modal-body, #modalMessage #lblMessage').textContent().catch(() => "") ?? "";
        log("info", `modalMessage appeared: "${msgText.trim().substring(0, 100)}"`);
        const msgCloseBtn = policyIframe.locator('#modalMessage .btn, #modalMessage button[data-dismiss="modal"]');
        await msgCloseBtn.first().click({ force: true }).catch(() => {});
        await page.waitForTimeout(1000);
      }

      // Check for #modalSearch (lookup results) — click first result to confirm
      const modalSearch = policyIframe.locator("#modalSearch.modal.fade.in, #modalSearch.in");
      if (await modalSearch.isVisible().catch(() => false)) {
        log("info", "Branch code search modal appeared, selecting first result");

        // Click the first clickable result in the search results table
        const firstResult = policyIframe.locator('#linkTable a, #linkTable tr[onclick], #linkTable td a, #linkTable tr td').first();
        if (await firstResult.isVisible().catch(() => false)) {
          await firstResult.click();
          log("info", "Clicked first search result");
          await page.waitForTimeout(2000);
        } else {
          log("info", "No results in search modal, closing");
          const closeBtn = policyIframe.locator('#modalSearch button[data-dismiss="modal"], #modalSearch .close, #modalSearch .btn');
          await closeBtn.first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } else {
        log("info", "No search modal appeared after Tab — branch code auto-resolved");
      }

      // Verify the branch code was set by reading the description field
      const branchDesc = await policyIframe.locator("#txtDesc30").inputValue().catch(() => "");
      const branchVal = await branchInput.inputValue().catch(() => "");
      log("info", `Branch code description: "${branchDesc}"`);

      // If the description is empty, the branch code didn't resolve — try the bank name as fallback
      if (!branchDesc && matched) {
        log("warn", `Branch code ${numericBranchCode} didn't resolve, trying bank name "${params.branchCode}" as fallback`);
        await branchInput.click();
        await page.waitForTimeout(300);
        await branchInput.click({ clickCount: 3 });
        await branchInput.fill(params.branchCode);
        await page.waitForTimeout(500);
        await branchInput.press("Tab");
        await page.waitForTimeout(3000);

        // Handle search modal
        if (await modalSearch.isVisible().catch(() => false)) {
          const firstResult = policyIframe.locator('#linkTable a, #linkTable tr[onclick], #linkTable td a, #linkTable tr td').first();
          if (await firstResult.isVisible().catch(() => false)) {
            await firstResult.click();
            await page.waitForTimeout(2000);
          }
        }

        // Dismiss any modals
        const anyModal = policyIframe.locator('.modal.fade.in');
        if (await anyModal.first().isVisible().catch(() => false)) {
          await policyIframe.locator('.modal.fade.in .btn, .modal.fade.in button[data-dismiss="modal"]').first().click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
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
