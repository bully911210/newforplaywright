import { getConfig } from "../config.js";
import { log, logEmitter } from "../utils/logger.js";
import { listClients } from "../sheets/client.js";
import { processRow } from "./process-row.js";
import { runWithWorker } from "./browser-manager.js";

function emitStatus(state: "idle" | "polling" | "processing", detail?: string): void {
  logEmitter.emit("status", { state, detail, timestamp: new Date().toISOString() });
}

let polling = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let processing = false;

/** Max concurrent rows to process at once (1-5). Default: 1. */
let maxConcurrency = 1;

export function getConcurrency(): number {
  return maxConcurrency;
}

export function setConcurrency(n: number): void {
  maxConcurrency = Math.max(1, Math.min(5, Math.floor(n)));
  log("info", `Concurrency set to ${maxConcurrency}x`);
}

/**
 * Start polling the Google Sheet for rows ready to process.
 * Only rows with status "New" in column A are picked up.
 * Processes up to `maxConcurrency` rows simultaneously.
 */
export function startPolling(intervalMs?: number): { success: boolean; message: string } {
  if (polling) {
    return { success: false, message: "Polling is already running." };
  }

  const config = getConfig();
  const interval = intervalMs ?? config.pollIntervalMs;

  polling = true;
  log("info", `Sheet polling started (interval: ${interval}ms, concurrency: ${maxConcurrency}x)`);
  emitStatus("polling");
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
  emitStatus("idle");
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
    log("info", "Poll: skipping - already processing");
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
    emitStatus("polling", "Checking for new rows...");
    log("info", "Poll: checking for unprocessed rows...");

    const clients = await listClients(sheetUrl, config.columnMapping);

    // Only process rows where status is explicitly "New"
    const unprocessedRows = clients.filter((c) => {
      const status = (c.status || "").trim().toLowerCase();
      return status === "new";
    });

    if (unprocessedRows.length === 0) {
      log("info", "Poll: no unprocessed rows found");
      return;
    }

    log("info", `Poll: found ${unprocessedRows.length} unprocessed row(s): ${unprocessedRows.map((r) => r.rowNumber).join(", ")}`);

    if (maxConcurrency <= 1) {
      // Sequential mode (1x) — original behavior
      for (const row of unprocessedRows) {
        if (!polling) {
          log("info", "Poll: stopped during processing");
          break;
        }
        emitStatus("processing", `Row ${row.rowNumber} (${row.name})`);
        log("info", `Poll: processing row ${row.rowNumber} (${row.name})...`);
        const result = await processRow(row.rowNumber);
        log("info", `Poll: row ${row.rowNumber} result: ${result.success ? "SUCCESS" : "FAILED"} - ${result.message}`);

        if (unprocessedRows.length > 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    } else {
      // Concurrent mode (2-5x) — process N rows at a time, each in its own worker
      const batchSize = Math.min(maxConcurrency, unprocessedRows.length);
      log("info", `Poll: processing ${batchSize} rows concurrently (${maxConcurrency}x mode)`);

      for (let i = 0; i < unprocessedRows.length; i += batchSize) {
        if (!polling) {
          log("info", "Poll: stopped during processing");
          break;
        }

        const batch = unprocessedRows.slice(i, i + batchSize);
        const names = batch.map((r) => `Row ${r.rowNumber}`).join(", ");
        emitStatus("processing", `${names} (${batch.length} concurrent)`);

        const promises = batch.map((row, idx) => {
          const workerId = `w${idx + 1}`;
          return runWithWorker(workerId, async () => {
            log("info", `Poll [${workerId}]: processing row ${row.rowNumber} (${row.name})...`);
            const result = await processRow(row.rowNumber);
            log("info", `Poll [${workerId}]: row ${row.rowNumber} result: ${result.success ? "SUCCESS" : "FAILED"} - ${result.message}`);
            return result;
          });
        });

        await Promise.allSettled(promises);

        // Small delay between batches
        if (i + batchSize < unprocessedRows.length) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("error", `Poll error: ${msg}`);
  } finally {
    processing = false;
    if (polling) emitStatus("polling");
  }
}
