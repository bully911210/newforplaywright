import { chromium, type BrowserContext, type Page } from "playwright";
import path from "path";
import fs from "node:fs";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";

let browserContext: BrowserContext | null = null;

const MAX_LAUNCH_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Remove stale Chromium lock files that prevent the browser from launching
 * after a crash or unclean shutdown.
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

export async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) return browserContext;

  const config = getConfig();
  const userDataDir = path.resolve(config.userDataDir);

  // Clean stale locks from previous crash/unclean shutdown
  cleanStaleLocks(userDataDir);

  for (let attempt = 1; attempt <= MAX_LAUNCH_RETRIES; attempt++) {
    try {
      log("info", `Launching browser (attempt ${attempt}/${MAX_LAUNCH_RETRIES}) at ${userDataDir}`);

      browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: config.headless,
        viewport: { width: 1366, height: 768 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-gpu",
        ],
      });

      browserContext.on("close", () => {
        browserContext = null;
        log("info", "Browser context closed");
      });

      log("info", "Browser launched successfully");
      return browserContext;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Browser launch attempt ${attempt} failed: ${msg}`);

      browserContext = null;

      if (attempt < MAX_LAUNCH_RETRIES) {
        // Clean locks again in case a failed launch created new ones
        cleanStaleLocks(userDataDir);
        log("info", `Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        // All retries failed — try nuclear option: reset corrupted profile
        log("warn", `All ${MAX_LAUNCH_RETRIES} launch attempts failed. Attempting profile reset...`);
        const recovered = await resetCorruptProfile(userDataDir, config);
        if (recovered) {
          browserContext = recovered;
          return recovered;
        }
        throw new Error(`Browser failed to launch after ${MAX_LAUNCH_RETRIES} attempts + profile reset: ${msg}`);
      }
    }
  }

  // TypeScript needs this but it's unreachable
  throw new Error("Unreachable");
}

/**
 * Nuclear fallback: rename the corrupted profile directory and launch with a fresh one.
 * This handles the case where lock files have permanent OS-level EBUSY locks.
 */
async function resetCorruptProfile(
  userDataDir: string,
  config: ReturnType<typeof getConfig>
): Promise<BrowserContext | null> {
  try {
    const corruptDir = `${userDataDir}-corrupt-${Date.now()}`;
    log("warn", `Renaming corrupted profile to: ${corruptDir}`);
    fs.renameSync(userDataDir, corruptDir);

    log("info", `Launching browser with fresh profile at ${userDataDir}`);
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
      browserContext = null;
      log("info", "Browser context closed");
    });

    log("info", "Browser launched successfully after profile reset");
    return ctx;
  } catch (resetErr) {
    log("error", `Profile reset also failed: ${resetErr}`);
    return null;
  }
}

export async function getPage(): Promise<Page> {
  const context = await getBrowserContext();
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : await context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
  }
}
