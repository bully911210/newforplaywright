#!/usr/bin/env node

/**
 * Portable entry point for MMX auto-polling + dashboard.
 *
 * ORDER MATTERS. The very first import MUST be ./portable/bootstrap.js —
 * its top-level code sets PLAYWRIGHT_BROWSERS_PATH and other env vars that
 * Playwright reads at its own module-load time. Any import that transitively
 * loads `playwright` (automation/*, etc.) must come after.
 */

// 1) First — side-effect import that sets env vars at module-load time.
import "./portable/bootstrap.js";

// 2) Then the bootstrap function + error helpers for use inside main().
import { bootstrap, writeBootLog, BUILD_VERSION } from "./portable/bootstrap.js";

// 3) Now safe to load modules that pull in Playwright.
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config.js";
import { log } from "./utils/logger.js";
import { startPolling, stopPolling } from "./automation/poll-sheet.js";
import { closeAllBrowsers, killOrphanedChrome } from "./automation/browser-manager.js";
import { startDashboard, stopDashboard } from "./dashboard/server.js";
import { getDataDir } from "./portable/paths.js";

async function main() {
  // Heavy bootstrap (extract Chromium, validate, migrate) — must run before any
  // code path that triggers chromium.launch().
  try {
    bootstrap();
  } catch (err) {
    handleFatal("Bootstrap failed", err);
  }

  // Self-test mode — validates that Playwright can launch extracted Chromium.
  if (process.env.MMX_SELF_TEST === "1" || process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }

  const config = getConfig();

  log("info", `MMX Portable ${BUILD_VERSION} starting...`);
  log("info", `Data dir: ${getDataDir()}`);
  log("info", `Poll interval: ${config.pollIntervalMs}ms`);
  log("info", `Sheet URL: ${config.googleSheetWebAppUrl ? "configured" : "MISSING"}`);
  log("info", `Headless: ${config.headless}`);
  log("info", `Dashboard port: ${config.dashboardPort}`);

  if (!config.googleSheetWebAppUrl) {
    handleFatal("Configuration missing", new Error("GOOGLE_SHEET_WEBAPP_URL not configured"));
  }

  killOrphanedChrome();
  startDashboard(config.dashboardPort);

  const result = startPolling();
  log("info", result.message);

  openDashboardInBrowser(config.dashboardPort);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "Shutting down...");
    stopPolling();
    stopDashboard();
    await closeAllBrowsers();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("uncaughtException", async (err) => {
    writeBootLog(`uncaughtException: ${err.stack || err.message}`);
    log("error", `Uncaught exception: ${err.message}`);
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    stopPolling();
    stopDashboard();
    await closeAllBrowsers().catch(() => {});
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    writeBootLog(`unhandledRejection: ${message}`);
  });

  setInterval(() => {}, 1 << 30);
}

async function runSelfTest(): Promise<void> {
  process.stderr.write(`\nMMX-Portable ${BUILD_VERSION} — SELF TEST\n`);
  process.stderr.write(`Data dir: ${getDataDir()}\n`);
  process.stderr.write(`PLAYWRIGHT_BROWSERS_PATH: ${process.env.PLAYWRIGHT_BROWSERS_PATH}\n\n`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require("playwright");
    process.stderr.write("OK  playwright module loaded\n");

    const execPath = chromium.executablePath();
    process.stderr.write(`OK  chromium.executablePath() = ${execPath}\n`);

    if (!fs.existsSync(execPath)) {
      throw new Error(`chrome.exe does NOT exist at ${execPath}`);
    }
    process.stderr.write("OK  chrome.exe exists on disk\n");

    // Mirrors the 3-tier fallback in browser-manager.ts
    const tempUserData = path.join(getDataDir(), "user-data-selftest");
    const baseOpts = {
      headless: false,
      viewport: { width: 1366, height: 768 },
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu"],
    };
    const strategies = [
      { label: "bundled Chromium", opts: baseOpts },
      { label: "system Edge", opts: { ...baseOpts, channel: "msedge" } },
      { label: "system Chrome", opts: { ...baseOpts, channel: "chrome" } },
    ];

    let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
    let launchedWith = "";
    for (const s of strategies) {
      try {
        process.stderr.write(`Launching via ${s.label}...\n`);
        ctx = await chromium.launchPersistentContext(tempUserData, s.opts as Parameters<typeof chromium.launchPersistentContext>[1]);
        launchedWith = s.label;
        break;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        process.stderr.write(`   ${s.label} failed: ${em.split("\n")[0]}\n`);
      }
    }
    if (!ctx) throw new Error("All browser launch strategies failed");
    process.stderr.write(`OK  Browser launched via ${launchedWith}\n`);

    const page = await ctx.newPage();
    await page.goto("about:blank");
    process.stderr.write("OK  Page navigation succeeded\n");

    await ctx.close();
    process.stderr.write("OK  Clean shutdown\n\n");
    process.stderr.write("SELF TEST PASSED\n");
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    process.stderr.write(`\nSELF TEST FAILED: ${msg}\n`);
    writeBootLog(`SELF TEST FAILED: ${msg}`);
    process.exit(2);
  }
}

function openDashboardInBrowser(port: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require("node:child_process");
    const url = `http://localhost:${port}`;
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Non-fatal
  }
}

function handleFatal(context: string, err: unknown): never {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err);
  const line = `${context}: ${msg}`;

  try { writeBootLog(`FATAL ${line}`); } catch { /* ignore */ }

  process.stderr.write("\n");
  process.stderr.write("=".repeat(72) + "\n");
  process.stderr.write(`MMX-Portable ${BUILD_VERSION} — FATAL ERROR\n`);
  process.stderr.write("=".repeat(72) + "\n");
  process.stderr.write(`${line}\n\n`);
  process.stderr.write(`Log: %LOCALAPPDATA%\\MMX-Portable\\last-error.log\n`);
  process.stderr.write(`Send this file to the developer.\n\n`);
  process.stderr.write("Press Enter to exit.\n");

  try {
    const buf = Buffer.alloc(1);
    fs.readSync(0, buf, 0, 1, null);
  } catch {
    const end = Date.now() + 30_000;
    while (Date.now() < end) { /* busy wait 30s */ }
  }

  process.exit(1);
}

main().catch((error) => {
  handleFatal("Main loop error", error);
});
