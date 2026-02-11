import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";
import { listClients } from "../sheets/client.js";
import { processRow } from "./process-row.js";

let polling = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let processing = false;

/**
 * Start polling the Google Sheet for new unprocessed rows.
 * Rows with an empty or blank status column (A) are considered "new".
 * Processes one row at a time, sequentially.
 */
export function startPolling(intervalMs?: number): { success: boolean; message: string } {
  if (polling) {
    return { success: false, message: "Polling is already running." };
  }

  const config = getConfig();
  const interval = intervalMs ?? config.pollIntervalMs;

  polling = true;
  log("info", `Sheet polling started (interval: ${interval}ms)`);
  schedulePoll(interval);

  return { success: true, message: `Polling started. Checking every ${interval / 1000}s for new rows.` };
}

export function stopPolling(): { success: boolean; message: string } {
  if (!polling) {
    return { success: false, message: "Polling is not running." };
  }

  polling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  log("info", "Sheet polling stopped");
  return { success: true, message: "Polling stopped." };
}

export function isPolling(): boolean {
  return polling;
}

function schedulePoll(intervalMs: number) {
  if (!polling) return;

  pollTimer = setTimeout(async () => {
    await pollOnce();
    schedulePoll(intervalMs);
  }, intervalMs);
}

async function pollOnce() {
  if (processing) {
    log("info", "Poll: skipping - already processing a row");
    return;
  }

  const config = getConfig();
  const sheetUrl = config.googleSheetWebAppUrl;

  if (!sheetUrl) {
    log("error", "Poll: no Google Sheet URL configured");
    return;
  }

  try {
    processing = true;
    log("info", "Poll: checking for unprocessed rows...");

    // Single API call to fetch all rows (includes status)
    const clients = await listClients(sheetUrl, config.columnMapping);

    // Find rows where status is empty or "New"
    const unprocessedRows = clients.filter((c) => {
      const status = (c.status || "").trim().toLowerCase();
      return status === "" || status === "new";
    });

    if (unprocessedRows.length === 0) {
      log("info", "Poll: no unprocessed rows found");
      return;
    }

    log("info", `Poll: found ${unprocessedRows.length} unprocessed row(s): ${unprocessedRows.map((r) => r.rowNumber).join(", ")}`);

    // Process rows one at a time
    for (const row of unprocessedRows) {
      if (!polling) {
        log("info", "Poll: stopped during processing");
        break;
      }

      log("info", `Poll: processing row ${row.rowNumber} (${row.name})...`);
      const result = await processRow(row.rowNumber);
      log("info", `Poll: row ${row.rowNumber} result: ${result.success ? "SUCCESS" : "FAILED"} - ${result.message}`);

      // Small delay between rows to avoid overwhelming the system
      if (unprocessedRows.length > 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Poll error: ${msg}`);
  } finally {
    processing = false;
  }
}
