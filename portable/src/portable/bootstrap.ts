import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EMBEDDED_ENV } from "./embedded-env.js";

/**
 * Bump on every new exe release. Version-mismatched installs auto-wipe
 * the browsers/ folder on next launch (self-healing for broken prior installs).
 */
export const BUILD_VERSION = "2026.04.22.4";

const ERROR_LOG_NAME = "last-error.log";
const BUILD_VERSION_FILE = ".build-version";

// ============================================================
// MODULE-LOAD SIDE EFFECTS (critical: must run before Playwright import)
// ============================================================
//
// Playwright's registry caches PLAYWRIGHT_BROWSERS_PATH at module-load time.
// Any code that runs later (including inside bootstrap()) is too late —
// Playwright has already locked in the path. So we set env vars here, at the
// top level, and arrange standalone.ts so that this module is imported
// before anything that transitively imports `playwright`.

const _packaged = typeof (process as { pkg?: unknown }).pkg !== "undefined";
const _localAppData =
  process.env.LOCALAPPDATA ||
  path.join(os.homedir(), "AppData", "Local");
const _dataDir = _packaged
  ? path.join(_localAppData, "MMX-Portable")
  : path.resolve(process.cwd(), ".portable-data");
const _browsersDir = path.join(_dataDir, "browsers");
const _userDataDir = path.join(_dataDir, "user-data");
const _screenshotDir = path.join(_dataDir, "screenshots");

// Create the writable directories up-front so logging / extraction never fails.
for (const d of [_dataDir, _browsersDir, _userDataDir, _screenshotDir]) {
  if (!fs.existsSync(d)) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      // Non-fatal; individual creators will retry
    }
  }
}

// Playwright env — set BEFORE it's loaded
process.env.PLAYWRIGHT_BROWSERS_PATH = _browsersDir;
process.env.PLAYWRIGHT_SKIP_BROWSER_GC = "1";
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

// Inject embedded .env defaults (respect anything already set in the real env)
for (const [k, v] of Object.entries(EMBEDDED_ENV)) {
  if (process.env[k] === undefined || process.env[k] === "") {
    process.env[k] = v;
  }
}

// Sidecar .env next to the exe overrides embedded defaults
if (_packaged) {
  try {
    const sidecar = path.join(path.dirname(process.execPath), ".env");
    if (fs.existsSync(sidecar)) {
      const text = fs.readFileSync(sidecar, "utf-8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
      writeBootLog(`Sidecar .env loaded from ${sidecar}`);
    }
  } catch (err) {
    writeBootLog(`Failed to read sidecar .env: ${err}`);
  }
}

// Re-assert PLAYWRIGHT_BROWSERS_PATH in case sidecar .env tried to override it.
// The whole point of bundling Chromium is that the portable one always wins.
process.env.PLAYWRIGHT_BROWSERS_PATH = _browsersDir;
process.env.USER_DATA_DIR = _userDataDir;

// ============================================================
// Deferred heavy work — called explicitly from main()
// ============================================================

/**
 * Does the heavy lifting: migration of broken prior installs, Chromium
 * extraction from the pkg snapshot, and post-extraction validation.
 */
export function bootstrap(): void {
  writeBootLog(`MMX-Portable bootstrap starting (build ${BUILD_VERSION})`);
  writeBootLog(`Data dir: ${_dataDir}`);
  writeBootLog(`PLAYWRIGHT_BROWSERS_PATH: ${process.env.PLAYWRIGHT_BROWSERS_PATH}`);

  migrateIfVersionChanged();
  extractChromiumIfMissing();
  validateChromium();
  writeVersionMarker();

  writeBootLog("Bootstrap complete.");
}

function migrateIfVersionChanged(): void {
  const markerPath = path.join(_dataDir, BUILD_VERSION_FILE);
  const prior = fs.existsSync(markerPath)
    ? fs.readFileSync(markerPath, "utf-8").trim()
    : null;

  if (prior === BUILD_VERSION) return;

  writeBootLog(
    prior
      ? `Build changed (${prior} -> ${BUILD_VERSION}). Clearing stale browsers/.`
      : `No prior install marker. Clearing any stale browsers/.`,
  );

  if (fs.existsSync(_browsersDir)) {
    try {
      fs.rmSync(_browsersDir, { recursive: true, force: true });
      fs.mkdirSync(_browsersDir, { recursive: true });
      writeBootLog(`Reset browsers/ at ${_browsersDir}`);
    } catch (err) {
      writeBootLog(`WARNING: could not reset browsers/: ${err}`);
    }
  }
}

function writeVersionMarker(): void {
  try {
    const markerPath = path.join(_dataDir, BUILD_VERSION_FILE);
    fs.writeFileSync(markerPath, BUILD_VERSION, "utf-8");
  } catch (err) {
    writeBootLog(`Could not write version marker: ${err}`);
  }
}

function extractChromiumIfMissing(): void {
  if (!_packaged) return;

  const snapshotChromiumRoot = path.join(__dirname, "..", "assets", "chromium");
  if (!fs.existsSync(snapshotChromiumRoot)) {
    const msg = `FATAL: Embedded Chromium not found in pkg snapshot at ${snapshotChromiumRoot}`;
    writeBootLog(msg);
    throw new Error(msg);
  }

  const topEntries = fs.readdirSync(snapshotChromiumRoot);
  const revDir = topEntries.find((e) => e.startsWith("chromium-"));
  if (!revDir) {
    const msg = "FATAL: No chromium-* folder in snapshot";
    writeBootLog(msg);
    throw new Error(msg);
  }

  const chromeExe = path.join(_browsersDir, revDir, "chrome-win64", "chrome.exe");
  if (fs.existsSync(chromeExe)) {
    writeBootLog(`Chromium already extracted at ${chromeExe}`);
    return;
  }

  writeBootLog(`First run: extracting Chromium (~400MB). Please wait ~30s...`);
  process.stderr.write("First run: extracting embedded Chromium. Please wait ~30 seconds...\n");

  const source = path.join(snapshotChromiumRoot, revDir);
  const dest = path.join(_browsersDir, revDir);

  try {
    copyDirRecursive(source, dest);
    writeBootLog("Chromium extraction complete.");
    process.stderr.write("Chromium extraction complete.\n");
  } catch (err) {
    const msg = `FATAL: Chromium extraction failed: ${err}`;
    writeBootLog(msg);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new Error(msg);
  }
}

function validateChromium(): void {
  if (!_packaged) return;

  const topEntries = fs
    .readdirSync(_browsersDir)
    .filter((e) => e.startsWith("chromium-"));
  if (topEntries.length === 0) {
    throw new Error(`FATAL: No chromium-* directory under ${_browsersDir}`);
  }

  const rev = topEntries[0];
  const chromeDir = path.join(_browsersDir, rev, "chrome-win64");

  const required = [
    "chrome.exe",
    "chrome.dll",
    "icudtl.dat",
    "v8_context_snapshot.bin",
    "resources.pak",
  ];

  for (const file of required) {
    const p = path.join(chromeDir, file);
    if (!fs.existsSync(p)) {
      throw new Error(`FATAL: Missing required Chromium file: ${file} at ${chromeDir}`);
    }
    if (fs.statSync(p).size === 0) {
      throw new Error(`FATAL: Zero-byte Chromium file: ${file}`);
    }
  }

  writeBootLog(`Chromium validated at ${chromeDir}`);
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function writeBootLog(line: string): void {
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}\n`;
  try { process.stderr.write(entry); } catch { /* ignore */ }
  try {
    const logPath = path.join(_dataDir, ERROR_LOG_NAME);
    fs.appendFileSync(logPath, entry, "utf-8");
  } catch {
    // ignore
  }
}

// Re-export for callers that need them
export const getDataDirSync = (): string => _dataDir;
export const getBrowsersDirSync = (): string => _browsersDir;
