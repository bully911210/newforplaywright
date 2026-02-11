import { chromium, type BrowserContext, type Page } from "playwright";
import path from "path";
import { getConfig } from "../config.js";
import { log } from "../utils/logger.js";

let browserContext: BrowserContext | null = null;

export async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) return browserContext;

  const config = getConfig();
  const userDataDir = path.resolve(config.userDataDir);

  log("info", `Launching browser with persistent context at ${userDataDir}`);

  browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: config.headless,
    viewport: { width: 1366, height: 768 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  browserContext.on("close", () => {
    browserContext = null;
    log("info", "Browser context closed");
  });

  return browserContext;
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
