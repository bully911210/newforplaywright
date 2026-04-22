import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

/**
 * Bundle all TypeScript sources into a single CJS file ready for pkg.
 * Inlines dashboard.html via the text loader so the dashboard can serve
 * it without a filesystem read at runtime.
 */
await build({
  entryPoints: ["src/standalone.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/bundle.cjs",
  loader: { ".html": "text" },
  // playwright loads chromium via dynamic requires into node_modules — keep external
  // so pkg can serve from the snapshot, rather than esbuild trying to inline it.
  external: ["playwright", "playwright-core", "chromium-bidi"],
  logLevel: "info",
  legalComments: "none",
  minify: false,
  sourcemap: false,
});

// Ensure dist exists
if (!fs.existsSync("dist")) fs.mkdirSync("dist", { recursive: true });

const size = fs.statSync("dist/bundle.cjs").size;
console.log(`✅ bundle.cjs written (${(size / 1024).toFixed(1)} KB)`);
