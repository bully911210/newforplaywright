import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Copy the locally installed Playwright Chromium into assets/chromium/
 * so pkg can embed it inside the .exe. Run once per Playwright version change.
 */
const SOURCE = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "ms-playwright",
);

const DEST = path.resolve("assets", "chromium");

if (!fs.existsSync(SOURCE)) {
  console.error(`❌ ms-playwright dir not found: ${SOURCE}`);
  console.error(`   Run "npx playwright install chromium" first.`);
  process.exit(1);
}

// Find the chromium-NNNN folder (latest if multiple)
const entries = fs.readdirSync(SOURCE, { withFileTypes: true });
const chromiumDirs = entries
  .filter((e) => e.isDirectory() && /^chromium-\d+$/.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]));

if (chromiumDirs.length === 0) {
  console.error("❌ No chromium-NNNN directory found in ms-playwright");
  process.exit(1);
}

const picked = chromiumDirs[0];
const sourceChromium = path.join(SOURCE, picked);
const destChromium = path.join(DEST, picked);

console.log(`Staging ${picked} → assets/chromium/${picked}`);

if (fs.existsSync(DEST)) {
  console.log("  Removing existing assets/chromium ...");
  fs.rmSync(DEST, { recursive: true, force: true });
}
fs.mkdirSync(DEST, { recursive: true });

let fileCount = 0;
let totalBytes = 0;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      fileCount++;
      totalBytes += fs.statSync(s).size;
    }
  }
}

copyDir(sourceChromium, destChromium);

console.log(
  `✅ Copied ${fileCount} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) to assets/chromium/${picked}`,
);
