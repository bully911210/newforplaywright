#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getConfig } from "./config.js";
import { log } from "./utils/logger.js";
import { withRetry } from "./utils/retry.js";
import { fetchClientRow, listClients, updateCell } from "./sheets/client.js";
import { loginToMMX } from "./automation/login.js";
import { fillClientSearch } from "./automation/client-search.js";
import { fillClientInfo } from "./automation/client-info.js";
import { fillPolicyInfo } from "./automation/policy-info.js";
import { fillBankDetails } from "./automation/bank-details.js";
import { fileClientTab, filePolicyTab } from "./automation/file-tab.js";
import { fillCoverTab } from "./automation/cover-tab.js";
import { finalizeSubmission } from "./automation/finalize.js";
import { closeBrowser } from "./automation/browser-manager.js";
import { startPolling, stopPolling, isPolling } from "./automation/poll-sheet.js";
import { processRow } from "./automation/process-row.js";

const server = new McpServer({
  name: "mmx-systems",
  version: "1.0.0",
});

// ─── Tool 1: fetch_client_data ───────────────────────────────────────────────

server.tool(
  "fetch_client_data",
  "Fetch a single client's data from the Google Sheet by row number",
  {
    rowNumber: z.number().int().min(2).describe("Row number in the Google Sheet (2 = first data row after header)"),
    sheetUrl: z.string().url().optional().describe("Google Apps Script Web App URL. Uses configured default if omitted."),
  },
  async ({ rowNumber, sheetUrl }) => {
    try {
      const config = getConfig();
      const url = sheetUrl || config.googleSheetWebAppUrl;
      if (!url) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No Google Sheet Web App URL configured. Set GOOGLE_SHEET_WEBAPP_URL in .env or pass sheetUrl parameter." }) }],
          isError: true,
        };
      }

      const result = await withRetry(
        () => fetchClientRow(url, rowNumber, config.columnMapping),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...result }, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 2: list_clients ────────────────────────────────────────────────────

server.tool(
  "list_clients",
  "List clients from the Google Sheet with summary info (name, row number)",
  {
    startRow: z.number().int().min(2).optional().describe("Start row (inclusive). Default: 2"),
    endRow: z.number().int().optional().describe("End row (inclusive). Default: last row"),
    sheetUrl: z.string().url().optional().describe("Google Apps Script Web App URL"),
  },
  async ({ startRow, endRow, sheetUrl }) => {
    try {
      const config = getConfig();
      const url = sheetUrl || config.googleSheetWebAppUrl;
      if (!url) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No Google Sheet Web App URL configured." }) }],
          isError: true,
        };
      }

      const result = await withRetry(
        () => listClients(url, config.columnMapping, startRow ?? 2, endRow),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, clients: result }, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 3: login_mmx ──────────────────────────────────────────────────────

server.tool(
  "login_mmx",
  "Log into MMX Systems (mmxsystems.co.za). Uses persistent browser context so login session is reused across calls.",
  {
    username: z.string().optional().describe("MMX username. Uses env var MMX_USERNAME if omitted."),
    password: z.string().optional().describe("MMX password. Uses env var MMX_PASSWORD if omitted."),
    forceRelogin: z.boolean().optional().default(false).describe("Force a fresh login even if session exists"),
  },
  async ({ username, password, forceRelogin }) => {
    try {
      const result = await withRetry(
        () => loginToMMX(username, password, forceRelogin),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 4: fill_client_search ──────────────────────────────────────────────

server.tool(
  "fill_client_search",
  "Step 1: Navigate to Client Search, select client type (Domestic/Commercial), pick product from dropdown, click New Client button",
  {
    clientType: z.enum(["Domestic", "Commercial"]).default("Domestic").describe("Client type radio button"),
    product: z.string().describe("Product to select from dropdown, e.g. 'GW6 - CIV DOMESTIC DONATION NPC'"),
  },
  async ({ clientType, product }) => {
    try {
      const result = await withRetry(
        () => fillClientSearch(clientType, product),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 5: fill_client_info ────────────────────────────────────────────────

server.tool(
  "fill_client_info",
  "Step 2: Fill Client tab (Donor info) fields: name, contact/surname, ID, phone, email, address, inception date",
  {
    name: z.string().optional().describe("Donor full name"),
    contactName: z.string().optional().describe("Contact surname"),
    idNumber: z.string().optional().describe("SA ID number"),
    cellphone: z.string().optional().describe("Cell phone number"),
    email: z.string().optional().describe("Email address"),
    homePhone: z.string().optional().describe("Home phone number"),
    workPhone: z.string().optional().describe("Work phone number"),
    address1: z.string().optional().describe("Residential address line 1"),
    address2: z.string().optional().describe("City"),
    address3: z.string().optional().describe("Province"),
    postalCode: z.string().optional().describe("Postal code"),
    inceptionDate: z.string().optional().describe("Client inception date in DD/MM/YYYY format"),
  },
  async (params) => {
    try {
      const result = await withRetry(
        () => fillClientInfo(params),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 6: fill_policy_info ────────────────────────────────────────────────

server.tool(
  "fill_policy_info",
  "Step 2: Fill Policy tab > Policy Info sub-tab fields (NPC company, payment frequency, dates, review month)",
  {
    npcCompanyCode: z.string().optional().describe("NPC company lookup code, e.g. 'CIV01'"),
    paymentFrequency: z.string().optional().describe("Payment frequency dropdown value"),
    inceptionDate: z.string().optional().describe("Inception date in DD/MM/YYYY format"),
    expiryDate: z.string().optional().describe("Expiry date in DD/MM/YYYY format"),
    reviewDate: z.string().optional().describe("Review date in DD/MM/YYYY format"),
    reviewMonth: z.string().optional().describe("Review month dropdown value"),
  },
  async (params) => {
    try {
      const result = await withRetry(
        () => fillPolicyInfo(params),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 6: fill_bank_details ───────────────────────────────────────────────

server.tool(
  "fill_bank_details",
  "Step 3: Fill Policy tab > Bank Details sub-tab fields (account holder, account number, branch code, collection day, payment method)",
  {
    accountHolder: z.string().optional().describe("Account holder / payee name"),
    accountNumber: z.string().optional().describe("Bank account number"),
    branchCode: z.string().optional().describe("Branch code (will use search/lookup)"),
    collectionDay: z.string().optional().describe("Collection day dropdown value, e.g. '01'"),
    paymentMethod: z.string().optional().describe("Payment method dropdown value"),
  },
  async (params) => {
    try {
      const result = await withRetry(
        () => fillBankDetails(params),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 7: file_submission ─────────────────────────────────────────────────

server.tool(
  "file_submission",
  "Step 4: Click the 'File' button at the bottom of the form to submit/file the client record",
  {
    confirmSubmit: z.boolean().describe("Must be true to confirm submission. Safety check."),
  },
  async ({ confirmSubmit }) => {
    try {
      const result = await finalizeSubmission(confirmSubmit);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 8: fill_cover_tab ─────────────────────────────────────────────────

server.tool(
  "fill_cover_tab",
  "Step 5: Fill Cover tab - click Donation row, add item, enter donation amount, and File. Requires Client and Policy tabs to be filed first.",
  {
    donationAmount: z.string().describe("Donation amount to enter (e.g. '50')"),
  },
  async ({ donationAmount }) => {
    try {
      const result = await fillCoverTab({ donationAmount });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 9: update_cell ──────────────────────────────────────────────────────

server.tool(
  "update_cell",
  "Update a single cell in the Google Sheet (e.g., set status column to 'Uploaded')",
  {
    row: z.number().int().min(2).describe("Row number in the Google Sheet"),
    col: z.string().describe("Column letter, e.g. 'A'"),
    value: z.string().describe("Value to write to the cell"),
    sheetUrl: z.string().url().optional().describe("Google Apps Script Web App URL. Uses configured default if omitted."),
  },
  async ({ row, col, value, sheetUrl }) => {
    try {
      const config = getConfig();
      const url = sheetUrl || config.googleSheetWebAppUrl;
      if (!url) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No Google Sheet Web App URL configured." }) }],
          isError: true,
        };
      }

      const result = await withRetry(
        () => updateCell(url, row, col, value),
        { maxAttempts: 2 }
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 10: process_row (full E2E for a single row) ─────────────────────

server.tool(
  "process_row",
  "Process a single sheet row through the full MMX flow: login → client → policy → bank → file → cover → update status. Fully automated.",
  {
    rowNumber: z.number().int().min(2).describe("Row number to process"),
  },
  async ({ rowNumber }) => {
    try {
      const result = await processRow(rowNumber);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 11: start_polling ─────────────────────────────────────────────────

server.tool(
  "start_polling",
  "Start auto-polling the Google Sheet for new rows (empty status column). Processes them through the full MMX flow automatically.",
  {
    intervalMs: z.number().int().min(5000).optional().describe("Poll interval in ms (default: 30000 = 30s)"),
  },
  async ({ intervalMs }) => {
    const result = startPolling(intervalMs);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  }
);

// ─── Tool 12: stop_polling ──────────────────────────────────────────────────

server.tool(
  "stop_polling",
  "Stop auto-polling the Google Sheet for new rows.",
  {},
  async () => {
    const result = stopPolling();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  }
);

// ─── Server Lifecycle ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "MMX MCP Server running on stdio");

  // Auto-start polling if configured
  const config = getConfig();
  if (config.autoStartPolling) {
    log("info", "Auto-starting sheet polling (AUTO_START_POLLING=true)");
    startPolling();
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    log("info", "Shutting down...");
    stopPolling();
    await closeBrowser();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    log("info", "Shutting down...");
    stopPolling();
    await closeBrowser();
    process.exit(0);
  });
}

main().catch((error) => {
  log("error", "Fatal error", error);
  process.exit(1);
});
