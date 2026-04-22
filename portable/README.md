# MMX Portable — Single-File `.exe` Build

Builds `MMX-Portable.exe` — a self-contained Windows executable that bundles
the Node runtime, Playwright, a Chromium binary, the automation code, and the
dashboard HTML into one file. Target machines do **not** need Node or
Playwright pre-installed.

## Output

- Exe: ~180 MB (Brotli-compressed)
- Runtime footprint on user's machine: `%LOCALAPPDATA%\MMX-Portable\`
  - `browsers/` — extracted Chromium (first-run only, ~400 MB)
  - `user-data/` — persistent Chromium profile (MMX login survives relaunches)
  - `screenshots/` — failure screenshots
  - `last-error.log` — rolling diagnostic log
  - `.build-version` — marker for auto-cleanup on version bumps

## Build

```bash
npm install
npm run stage-chromium   # copies installed Playwright Chromium into assets/
npm run bundle           # esbuild: TypeScript + dashboard.html -> dist/bundle.cjs
npm run package          # pkg: bundle + Node 20 + assets -> dist/MMX-Portable.exe
```

Or all at once: `npm run all`.

## How it works

1. **esbuild** bundles all source TS into a single CJS file, inlining
   `dashboard.html` via the text loader and leaving `playwright` as an external
   require so `pkg` can resolve it from its snapshot.
2. **@yao-pkg/pkg** compiles the bundle against Node 20 and folds in the
   Chromium directory as an asset.
3. At runtime, `portable/bootstrap.ts` top-level code fires before any
   Playwright import and sets `PLAYWRIGHT_BROWSERS_PATH` to
   `%LOCALAPPDATA%\MMX-Portable\browsers\`. On first run it extracts Chromium
   from the pkg snapshot into that directory.
4. Browser launch uses a 3-tier fallback — **bundled Chromium → system Edge →
   system Chrome** — so the app still works on Windows builds affected by the
   Chromium SxS manifest bug (which blocks bundled Chromium launch with a
   `spawn UNKNOWN` error).

## Configuration

Defaults for `MMX_USERNAME`, `GOOGLE_SHEET_WEBAPP_URL`, ports, etc. are
embedded in `src/portable/embedded-env.ts`. A sidecar `.env` placed next to
the `.exe` at deploy time overrides the embedded defaults — useful for
swapping credentials or the dashboard port without rebuilding.

## BUILD_VERSION

`src/portable/bootstrap.ts` exports `BUILD_VERSION`. Bump it on every
release — the exe compares this against the persisted `.build-version` marker
in the user's data dir. On mismatch it wipes the stale `browsers/` folder so
broken prior installs self-heal on next launch. `user-data/` is preserved.
