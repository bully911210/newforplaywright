import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Portable runtime paths — single source of truth for all writable locations.
 * When running as a packaged exe (process.pkg set by pkg), data lives in
 * %LOCALAPPDATA%\MMX-Portable\. When running via `node` in dev, data lives
 * next to the project.
 */

declare const process: NodeJS.Process & { pkg?: unknown };

export const isPackaged = typeof (process as { pkg?: unknown }).pkg !== "undefined";

/** Root writable dir for the portable app. Created on first access. */
export function getDataDir(): string {
  if (isPackaged) {
    const base =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    const dir = path.join(base, "MMX-Portable");
    ensureDir(dir);
    return dir;
  }
  // Dev mode: fall back to a sibling folder so nothing pollutes the real app
  const dir = path.resolve(process.cwd(), ".portable-data");
  ensureDir(dir);
  return dir;
}

export function getUserDataDir(): string {
  const dir = path.join(getDataDir(), "user-data");
  ensureDir(dir);
  return dir;
}

export function getScreenshotDir(): string {
  const dir = path.join(getDataDir(), "screenshots");
  ensureDir(dir);
  return dir;
}

export function getChromiumDir(): string {
  // Matches Playwright's expected layout: {base}/chromium-{rev}/chrome-win64/chrome.exe
  const dir = path.join(getDataDir(), "browsers");
  ensureDir(dir);
  return dir;
}

export function getSidecarEnvPath(): string | null {
  if (!isPackaged) return null;
  // Look for .env next to the exe (override mechanism)
  const exeDir = path.dirname(process.execPath);
  const envPath = path.join(exeDir, ".env");
  return fs.existsSync(envPath) ? envPath : null;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
