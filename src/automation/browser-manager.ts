import { chromium, type BrowserContext, type Page } from "playwright";
import { AsyncLocalStorage } from "node:async_hooks";
import { execSync } from "node:child_process";
import path from "path";
import fs from "node:fs";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";

/**
 * Browser instance pool — supports multiple concurrent browser instances.
 * Each instance gets its own user-data directory (user-data-3, user-data-3-w1, etc.)
 * The default instance (workerId = undefined) uses the base USER_DATA_DIR.
 *
 * Worker context is tracked via AsyncLocalStorage so automation functions
 * (login, fillClientInfo, etc.) automatically use the correct browser instance
 * without needing workerId passed through every function call.
 *
 * ZOMBIE PREVENTION: On startup, killOrphanedChrome() is called to kill any
 * Chrome processes left over from previous crashes. Before each browser launch,
 * killChromeForDir() kills any Chrome processes using the same user-data directory.
 */

const workerStorage = new AsyncLocalStorage<string>();

/** Run a function in the context of a specific worker ID. */
export function runWithWorker<T>(workerId: string, fn: () => Promise<T>): Promise<T> {
  return workerStorage.run(workerId, fn);
}

/** Get the current worker ID from async context, or "default". */
function currentWorkerId(): string {
  return workerStorage.getStore() || "default";
}

const instances = new Map<string, BrowserContext>();

const MAX_LAUNCH_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function getWorkerKey(workerId?: string): string {
  return workerId || "default";
}

function getUserDataDir(workerId?: string): string {
  const config = getConfig();
  const base = path.resolve(config.userDataDir);
  if (!workerId || workerId === "default") return base;
  return `${base}-${workerId}`;
}

/**
 * Remove stale Chromium lock files that prevent the browser from launching.
 */
function cleanStaleLocks(userDataDir: string): void {
  const lockFiles = ["lockfile", "SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const lockName of lockFiles) {
    const lockPath = path.join(userDataDir, lockName);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        log("info", `Removed stale lock file: ${lockName}`);
      }
    } catch (err) {
      log("warn", `Could not remove lock file ${lockName}: ${err}`);
    }
  }
}

/**
 * Kill ALL Chrome/Chromium processes whose command line includes any user-data dir
 * matching our configured base pattern. Called once on startup to clean up zombies
 * from previous crashes.
 *
 * On Windows: uses `wmic` to find chrome.exe processes by command line.
 * On Linux/Mac: uses `ps` + `grep`.
 */
export function killOrphanedChrome(): void {
  const config = getConfig();
  const baseDirName = path.basename(path.resolve(config.userDataDir));
  // Match user-data-6, user-data-6-w1, user-data-6-fresh2, user-data-5, etc.
  // We use the prefix without the trailing number to catch ALL our user-data dirs
  const prefix = baseDirName.replace(/-\d+$/, "-"); // "user-data-" from "user-data-6"

  if (process.platform === "win32") {
    try {
      // Find all chrome.exe processes with our user-data pattern in the command line
      const output = execSync(
        `wmic process where "name='chrome.exe' and commandline like '%${prefix}%'" get processid`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      const pids = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line));

      if (pids.length > 0) {
        log("warn", `🧹 ORPHAN CLEANUP: Found ${pids.length} zombie Chrome processes matching "${prefix}*"`);
        for (const pid of pids) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { encoding: "utf-8", timeout: 5000 });
            log("info", `  Killed zombie Chrome PID ${pid}`);
          } catch {
            // Process may have already exited
          }
        }
        // Wait a moment for processes to fully terminate and release lockfiles
        execSync("timeout /t 2 /nobreak >nul 2>&1", { timeout: 5000 });
      } else {
        log("info", `🧹 ORPHAN CLEANUP: No zombie Chrome processes found for "${prefix}*"`);
      }
    } catch (err) {
      log("warn", `Orphan Chrome cleanup failed (non-fatal): ${err}`);
    }
  } else {
    // Linux/Mac fallback
    try {
      const output = execSync(
        `ps aux | grep chrome | grep "${prefix}" | grep -v grep | awk '{print $2}'`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      const pids = output.split("\n").filter((line) => /^\d+$/.test(line));
      if (pids.length > 0) {
        log("warn", `🧹 ORPHAN CLEANUP: Found ${pids.length} zombie Chrome processes`);
        for (const pid of pids) {
          try {
            execSync(`kill -9 ${pid}`, { timeout: 5000 });
            log("info", `  Killed zombie Chrome PID ${pid}`);
          } catch {
            // Process may have already exited
          }
        }
      }
    } catch {
      // grep returns exit code 1 when no matches — that's fine
    }
  }
}

/**
 * Kill Chrome processes that are using a SPECIFIC user-data directory.
 * Called before each browser launch to ensure no zombie holds the lockfile.
 */
function killChromeForDir(userDataDir: string): void {
  const dirName = path.basename(userDataDir);

  if (process.platform === "win32") {
    try {
      const output = execSync(
        `wmic process where "name='chrome.exe' and commandline like '%${dirName}%'" get processid`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      const pids = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line));

      if (pids.length > 0) {
        log("warn", `🔪 PRE-LAUNCH CLEANUP: Killing ${pids.length} Chrome processes using ${dirName}`);
        for (const pid of pids) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { encoding: "utf-8", timeout: 5000 });
            log("info", `  Killed Chrome PID ${pid}`);
          } catch {
            // Already exited
          }
        }
        // Brief pause for lockfile release
        execSync("timeout /t 1 /nobreak >nul 2>&1", { timeout: 3000 });
      }
    } catch {
      // wmic may fail if no chrome.exe exists — that's OK
    }
  } else {
    try {
      const output = execSync(
        `ps aux | grep chrome | grep "${dirName}" | grep -v grep | awk '{print $2}'`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      const pids = output.split("\n").filter((line) => /^\d+$/.test(line));
      if (pids.length > 0) {
        log("warn", `🔪 PRE-LAUNCH CLEANUP: Killing ${pids.length} Chrome processes using ${dirName}`);
        for (const pid of pids) {
          try { execSync(`kill -9 ${pid}`, { timeout: 5000 }); } catch { /* already exited */ }
        }
      }
    } catch {
      // No matches — fine
    }
  }
}

export async function getBrowserContext(workerId?: string): Promise<BrowserContext> {
  const key = getWorkerKey(workerId);
  const existing = instances.get(key);
  if (existing) return existing;

  const config = getConfig();
  const userDataDir = getUserDataDir(workerId);

  // Kill any zombie Chrome processes holding this user-data dir's lockfile
  killChromeForDir(userDataDir);
  cleanStaleLocks(userDataDir);

  for (let attempt = 1; attempt <= MAX_LAUNCH_RETRIES; attempt++) {
    try {
      log("info", `[${key}] Launching browser (attempt ${attempt}/${MAX_LAUNCH_RETRIES}) at ${userDataDir}`);

      const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless: config.headless,
        viewport: { width: 1366, height: 768 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-gpu",
        ],
      });

      ctx.on("close", () => {
        instances.delete(key);
        log("info", `[${key}] Browser context closed`);
      });

      instances.set(key, ctx);
      log("info", `[${key}] Browser launched successfully`);
      return ctx;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `[${key}] Browser launch attempt ${attempt} failed: ${msg}`);

      if (attempt < MAX_LAUNCH_RETRIES) {
        cleanStaleLocks(userDataDir);
        log("info", `[${key}] Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        log("warn", `[${key}] All ${MAX_LAUNCH_RETRIES} attempts failed. Resetting profile...`);
        const recovered = await resetCorruptProfile(userDataDir, config, key);
        if (recovered) {
          instances.set(key, recovered);
          return recovered;
        }
        throw new Error(`[${key}] Browser failed after ${MAX_LAUNCH_RETRIES} attempts + reset: ${msg}`);
      }
    }
  }

  throw new Error("Unreachable");
}

async function resetCorruptProfile(
  userDataDir: string,
  config: ReturnType<typeof getConfig>,
  key: string
): Promise<BrowserContext | null> {
  // Strategy: try renaming the corrupt dir first. If that fails (Windows EBUSY lockfile),
  // try successive fresh directories (user-data-4-fresh1, user-data-4-fresh2, etc.)
  // This guarantees we ALWAYS get a working browser eventually.

  // Attempt 1: Try to rename the corrupted dir (works if lockfile isn't held)
  try {
    const corruptDir = `${userDataDir}-corrupt-${Date.now()}`;
    log("warn", `[${key}] Attempting to rename corrupted profile to: ${corruptDir}`);
    if (fs.existsSync(userDataDir)) {
      fs.renameSync(userDataDir, corruptDir);
      log("info", `[${key}] Successfully renamed corrupted profile`);
    }

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      viewport: { width: 1366, height: 768 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-gpu",
      ],
    });

    ctx.on("close", () => {
      instances.delete(key);
      log("info", `[${key}] Browser context closed`);
    });

    log("info", `[${key}] Browser launched after profile rename`);
    return ctx;
  } catch (renameErr) {
    log("warn", `[${key}] Rename/launch failed (likely EBUSY lockfile): ${renameErr}`);
  }

  // Attempt 2: Try fresh numbered directories — this ALWAYS works because the dir is new
  for (let i = 1; i <= 10; i++) {
    const freshDir = `${userDataDir}-fresh${i}`;
    try {
      // Skip directories that already have lockfiles (also corrupted)
      const lockPath = path.join(freshDir, "lockfile");
      if (fs.existsSync(lockPath)) {
        log("info", `[${key}] Skipping ${freshDir} — lockfile exists`);
        continue;
      }

      log("info", `[${key}] Trying fresh profile directory: ${freshDir}`);
      cleanStaleLocks(freshDir);

      const ctx = await chromium.launchPersistentContext(freshDir, {
        headless: config.headless,
        viewport: { width: 1366, height: 768 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-gpu",
        ],
      });

      ctx.on("close", () => {
        instances.delete(key);
        log("info", `[${key}] Browser context closed`);
      });

      log("info", `[${key}] ✅ Browser launched with fresh profile: ${freshDir}`);
      return ctx;
    } catch (freshErr) {
      log("warn", `[${key}] Fresh dir ${freshDir} also failed: ${freshErr}`);
      cleanStaleLocks(freshDir);
    }
  }

  log("error", `[${key}] ALL profile reset attempts exhausted (rename + 10 fresh dirs)`);
  return null;
}

export async function getPage(workerId?: string): Promise<Page> {
  const id = workerId ?? currentWorkerId();
  const context = await getBrowserContext(id === "default" ? undefined : id);
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : await context.newPage();
}

export async function closeBrowser(workerId?: string): Promise<void> {
  const id = workerId ?? currentWorkerId();
  const key = getWorkerKey(id === "default" ? undefined : id);
  const ctx = instances.get(key);
  if (ctx) {
    await ctx.close();
    instances.delete(key);
  }
}

export async function closeAllBrowsers(): Promise<void> {
  const keys = [...instances.keys()];
  for (const key of keys) {
    const ctx = instances.get(key);
    if (ctx) {
      await ctx.close().catch(() => {});
      instances.delete(key);
    }
  }
}
