#!/usr/bin/env node

/**
 * Standalone runner for MMX auto-polling + dashboard.
 * Runs the polling loop and serves the monitoring dashboard on localhost.
 *
 * Usage: node build/standalone.js
 */

import { getConfig } from "./config.js";
import { log } from "./utils/logger.js";
import { startPolling, stopPolling } from "./automation/poll-sheet.js";
import { closeBrowser } from "./automation/browser-manager.js";
import { startDashboard, stopDashboard } from "./dashboard/server.js";

async function main() {
  const config = getConfig();

  log("info", "MMX Standalone Poller starting...");
  log("info", `Poll interval: ${config.pollIntervalMs}ms`);
  log("info", `Sheet URL: ${config.googleSheetWebAppUrl ? "configured" : "MISSING"}`);
  log("info", `Headless: ${config.headless}`);
  log("info", `Dashboard port: ${config.dashboardPort}`);

  if (!config.googleSheetWebAppUrl) {
    log("error", "GOOGLE_SHEET_WEBAPP_URL not configured in .env");
    process.exit(1);
  }

  // Start dashboard server
  startDashboard(config.dashboardPort);

  // Start polling
  const result = startPolling();
  log("info", result.message);

  // Graceful shutdown
  const shutdown = async () => {
    log("info", "Shutting down...");
    stopPolling();
    stopDashboard();
    await closeBrowser();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  log("error", "Fatal error", error);
  process.exit(1);
});
