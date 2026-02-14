import { chromium, type BrowserContext, type Page } from "playwright";
import { AsyncLocalStorage } from "node:async_hooks";
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

export async function getBrowserContext(workerId?: string): Promise<BrowserContext> {
  const key = getWorkerKey(workerId);
  const existing = instances.get(key);
  if (existing) return existing;

  const config = getConfig();
  const userDataDir = getUserDataDir(workerId);

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
  try {
    const corruptDir = `${userDataDir}-corrupt-${Date.now()}`;
    log("warn", `[${key}] Renaming corrupted profile to: ${corruptDir}`);
    if (fs.existsSync(userDataDir)) {
      fs.renameSync(userDataDir, corruptDir);
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

    log("info", `[${key}] Browser launched after profile reset`);
    return ctx;
  } catch (resetErr) {
    log("error", `[${key}] Profile reset also failed: ${resetErr}`);
    return null;
  }
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
