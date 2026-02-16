# MMX Donation Upload Automation

Automated end-to-end system that reads client data from a Google Sheet and uploads NPC donation records to [MMX Systems](https://www.mmxsystems.co.za) using browser automation (Playwright).

---

## How It Works

```
Google Sheet  ──poll──▶  Node.js Poller  ──automate──▶  MMX Website
   (data)                  (Playwright)                  (form fill)
     ▲                         │
     │                         ▼
  status ◀── "Uploaded" ──  Dashboard
  updated                  localhost:3000
```

1. A Google Sheet holds client records (name, ID, bank details, dates, etc.)
2. The poller checks the sheet every 30 seconds for rows where column A = **"New"**
3. For each new row, it launches a Chromium browser and walks through the full MMX form:
   - Login → Client Search → Client Info → File Client → Policy Info → Bank Details → File Policy → Cover Tab → File Cover
4. On success: column A is set to **"Uploaded"** and all data columns turn green
5. On failure: column A gets the error message and turns red; a screenshot is saved
6. A real-time dashboard at `http://localhost:3000` shows live progress

---

## Project Structure

```
mmx-mcp-server/
├── src/
│   ├── index.ts                  # MCP Server (exposes tools for Claude/AI)
│   ├── standalone.ts             # Standalone poller + dashboard runner
│   ├── config.ts                 # Environment config loader
│   ├── types.ts                  # TypeScript interfaces
│   │
│   ├── automation/
│   │   ├── browser-manager.ts    # Chromium launch, retry, profile recovery
│   │   ├── login.ts              # MMX login automation
│   │   ├── client-search.ts      # Client Search → New Client
│   │   ├── client-info.ts        # Client tab form filling
│   │   ├── policy-info.ts        # Policy Info tab (dates, frequency, NPC)
│   │   ├── bank-details.ts       # Bank Details tab (account, branch code)
│   │   ├── file-tab.ts           # Click "File" on Client & Policy tabs
│   │   ├── cover-tab.ts          # Cover tab (donation amount, effective date)
│   │   ├── finalize.ts           # Final submission helper
│   │   ├── process-row.ts        # Full E2E: one sheet row → MMX upload
│   │   └── poll-sheet.ts         # Poll loop: check sheet, process new rows
│   │
│   ├── sheets/
│   │   └── client.ts             # Google Sheet API (fetch, update, highlight)
│   │
│   ├── dashboard/
│   │   ├── server.ts             # HTTP server + SSE streaming
│   │   ├── dashboard.html        # Single-page monitoring UI
│   │   └── run-history.ts        # In-memory run tracking
│   │
│   ├── utils/
│   │   ├── logger.ts             # Logger with EventEmitter for dashboard
│   │   └── retry.ts              # Generic retry wrapper
│   │
├── code.gs                       # Google Apps Script (deploy to Sheets)
├── .env.example                  # Template for environment config
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Google Sheet** with client data in columns A-S
- **MMX Systems** login credentials
- **Windows** (tested), should also work on macOS/Linux

### Step 1: Clone & Install

```bash
git clone https://github.com/bully911210/newforplaywright.git
cd newforplaywright
npm install
```

Playwright will automatically download a Chromium browser on first install.

### Step 2: Google Apps Script Setup

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code and paste the contents of `code.gs`
4. Click **Deploy → New deployment**
5. Set type to **Web app**
6. Set "Execute as" to **Me**
7. Set "Who has access" to **Anyone**
8. Click **Deploy** and copy the Web App URL

> **Important**: The script uses `getDisplayValues()` to read dates exactly as they appear in the sheet (DD/MM/YYYY for South African locale). This prevents date format corruption.

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
MMX_USERNAME=your_mmx_username
MMX_PASSWORD="your_mmx_password"
GOOGLE_SHEET_WEBAPP_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

### Step 4: Build

```bash
npm run build
```

### Step 5: Run

```bash
npm start
```

The system will:
- Start the monitoring dashboard at **http://localhost:3000**
- Begin polling the Google Sheet every 30 seconds
- Automatically process any rows where column A = "New"

---

## Google Sheet Layout

Your sheet must have this column layout (row 1 = headers, data starts at row 2):

| Column | Field | Example |
|--------|-------|---------|
| A | Status | `New` / `Uploaded` / `FAILED at...` |
| B | Client Name | `Franz` |
| C | Client Surname | `Badenhorst` |
| D | ID Number | `9112105080083` |
| E | Cellphone | `0621779799` |
| F | Email | `franz@example.com` |
| G | Address | `150 Soutpansberg Road` |
| H | City | `Pretoria` |
| I | Province | `Gauteng` |
| J | Postal Code | `0186` |
| K | Account Holder | `FH Badenhorst` |
| L | Bank | `Capitec` |
| M | Account Number | `2185450235` |
| N | Account Type | `Savings` or `Current` |
| O | Contract Amount | `50` |
| P | Payment Frequency | `Monthly` |
| Q | Debit Order Date | `15/02/2026` (DD/MM/YYYY) |
| R | Date Sale Made | `11/02/2026` (DD/MM/YYYY) |
| S | Agent | `Franz Badenhorst` |

### Status Flow

```
(empty) ──▶ "New" ──▶ "Processing..." ──▶ "Uploaded"
                                     └──▶ "FAILED at [step]: [error]"
```

- **Only rows with status "New" are processed** (case-insensitive)
- Set column A to `New` when a row is ready for upload
- The system ignores empty, "Uploaded", and "FAILED" rows

---

## Monitoring Dashboard

Open **http://localhost:3000** in your browser to see:

- **Live log stream** — real-time output from the automation
- **Run history** — success/failure status for each processed row
- **Current status** — idle, polling, or processing
- **Failure screenshots** — captured automatically when a step fails
- **Polling controls** — start/stop polling from the dashboard

---

## Running as an MCP Server

This project also works as a [Model Context Protocol](https://modelcontextprotocol.io/) server, exposing tools that Claude or other AI assistants can call:

| Tool | Description |
|------|-------------|
| `fetch_client_data` | Fetch a single row from the sheet |
| `list_clients` | List all clients with status |
| `login_mmx` | Log into MMX website |
| `fill_client_search` | Navigate to New Client form |
| `fill_client_info` | Fill client details tab |
| `fill_policy_info` | Fill policy info tab |
| `fill_bank_details` | Fill bank details tab |
| `file_submission` | Click File button |
| `fill_cover_tab` | Fill cover/donation tab |
| `update_cell` | Update a sheet cell |
| `process_row` | Full E2E: process one row |
| `start_polling` | Start auto-polling |
| `stop_polling` | Stop auto-polling |

To use as MCP server: `npm run mcp` (communicates via stdio).

> **Important**: The MCP server does NOT auto-poll. Only the standalone poller (`npm start`) polls. This prevents duplicate processing when both are running.

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MMX_USERNAME` | — | MMX login username |
| `MMX_PASSWORD` | — | MMX login password |
| `MMX_BASE_URL` | `https://www.mmxsystems.co.za` | MMX website URL |
| `GOOGLE_SHEET_WEBAPP_URL` | — | Apps Script Web App URL |
| `COLUMN_MAPPING` | (see .env.example) | JSON map of columns to fields |
| `HEADLESS` | `false` | Run browser headless (no GUI) |
| `USER_DATA_DIR` | `user-data-6` | Chromium profile directory |
| `NAVIGATION_TIMEOUT` | `30000` | Page navigation timeout (ms) |
| `ACTION_TIMEOUT` | `10000` | Element action timeout (ms) |
| `POLL_INTERVAL_MS` | `30000` | How often to check for new rows (ms) |
| `AUTO_START_POLLING` | `false` | MCP server auto-poll (keep `false`) |
| `DASHBOARD_PORT` | `3000` | Dashboard HTTP port |

---

## Troubleshooting

### Browser won't launch (EBUSY / lockfile error)

The Chromium profile directory has stale lock files from a crash. The system handles this automatically:
1. Cleans lock files on startup
2. Retries 3 times with 2-second delays
3. If all retries fail, renames the corrupted profile and creates a fresh one

If you still have issues, manually delete the `user-data-*` folder and restart.

### Dates are wrong on MMX website

Dates must come through as DD/MM/YYYY. The `code.gs` script uses `getDisplayValues()` to read the exact text from the sheet. If dates are wrong:
1. Check your Google Sheet's locale is set to **South Africa** (File → Settings → Locale)
2. Make sure you deployed the **latest** `code.gs` — create a **new deployment** (not update existing)
3. Update the URL in `.env` with the new deployment URL

### Rows not being picked up

- Column A must contain exactly `New` (case-insensitive)
- Empty cells, "Uploaded", or error messages are all skipped
- Check the dashboard at localhost:3000 for live logs

### Multiple browser windows open (duplicate processing)

This means multiple Node.js processes are all polling simultaneously. Fix:
1. Open Task Manager and kill **all** `node.exe` processes (except Figma extensions)
2. Kill all `chrome.exe` processes
3. Restart with `npm start` — only run ONE instance at a time
4. Never set `AUTO_START_POLLING=true` in `.env`

### Process hangs / browser stays open

The browser is closed automatically after each row (success or failure). If it's stuck:
1. Kill any `node` or `chrome` processes in Task Manager
2. Delete the `user-data-*` folder
3. Restart with `npm start`

---

## Scripts

```bash
npm run build    # Compile TypeScript → build/
npm run dev      # Watch mode (recompile on save)
npm start        # Run standalone poller + dashboard (MAIN ENTRY POINT)
npm run mcp      # Run MCP server (stdio mode, for Claude/AI tools)
```

---

## Architecture: Single-Poller Design

Only the **standalone poller** (`npm start` / `standalone.ts`) should ever poll and process rows. The MCP server (`npm run mcp` / `index.ts`) provides tools for manual control but **never auto-polls**.

This prevents a critical issue where multiple processes could simultaneously process the same row, creating duplicate client entries in MMX (which triggers real debit orders).

**Safeguards:**
- `index.ts` has no auto-polling code — removed entirely
- `.env` has `AUTO_START_POLLING=false` as a safety net
- On startup, `killOrphanedChrome()` cleans up zombie Chrome processes from previous crashes
- Before each browser launch, `killChromeForDir()` kills any Chrome using the same profile directory
- Graceful shutdown (`SIGINT`/`SIGTERM`) closes all browsers
- `uncaughtException` handler ensures browsers are cleaned up on crashes
