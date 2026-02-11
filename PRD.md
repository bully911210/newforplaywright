# MMX Systems Automation - Product Requirements Document

## Overview

An MCP (Model Context Protocol) server that automates the entry of NPC donation client records into the MMX Systems insurance administration platform. It reads client data from a Google Sheet and fills the multi-tab ASP.NET web form via Playwright browser automation, eliminating manual data entry.

## Problem Statement

Each new NPC (Non-Profit Company) donation client requires manual entry across three separate tabs in the MMX Systems web application: Client info, Policy/Bank details, and Cover/Donation amount. This is repetitive, error-prone, and time-consuming. The data already exists in a Google Sheet populated by sales agents.

## Solution

A TypeScript MCP server that exposes 9 tools, callable by any MCP-compatible AI client (e.g. Claude Code). The tools orchestrate a Playwright browser to fill and file each tab in the correct sequence, then update the Google Sheet status on completion.

## Target Platform

- **MMX Systems:** `https://www.mmxsystems.co.za/login.aspx` (ASP.NET WebForms, frameset-based)
- **Product:** GW6 - CIV DOMESTIC DONATION NPC
- **Client Type:** Domestic

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Language | TypeScript |
| Browser Automation | Playwright (Chromium, persistent context) |
| MCP Framework | `@modelcontextprotocol/sdk` v1.12+ |
| Schema Validation | Zod |
| Config | dotenv |
| Data Source | Google Sheets via Apps Script Web App |

## Architecture

```
Google Sheet (client data)
       |
       v
MCP Server (stdio transport)
       |
       v
Playwright (persistent Chromium context)
       |
       v
MMX Systems ASP.NET (frameset + iframes)
       |
       v
Google Sheet (status update)
```

### MMX Site Structure

The site uses a frameset that never changes URL after login. All interaction happens inside nested iframes:

```
login.aspx (main page)
  └── contentframe
        └── ClientSearch.aspx -> New Client form:
              ├── #ifrmClient   (Client/Donor info)
              ├── #ifrmPolicy   (Policy Info + Bank Details sub-tabs)
              └── #ifrmCover    (Cover items / Donation amount)
```

## Data Flow

### Google Sheet Schema (Columns A-S)

| Column | Field | Example |
|---|---|---|
| A | Status | "To be loaded" / "Uploaded" / "Error: ..." |
| B | Client Name | Franz |
| C | Client Surname | Badenhorst |
| D | ID Number | 9112105080083 |
| E | Cellphone | 0621779799 |
| F | Email | franz@example.co.za |
| G | Address | 150 Soutpansberg Road |
| H | City | Pretoria |
| I | Province | Gauteng |
| J | Postal Code | 0186 |
| K | Account Holder | FH Badenhorst |
| L | Bank | Capitec |
| M | Account Number | 2185450235 |
| N | Account Type | Savings |
| O | Contract Amount | 50 |
| P | Payment Frequency | Monthly |
| Q | Debit Order Date | 15/02/2026 |
| R | Date Sale Made | 02/10/2026 |
| S | Agent | Franz Badenhorst |

### Bank-to-Branch Code Mapping

| Bank | Branch Code |
|---|---|
| Capitec | 470010 |
| ABSA | 632005 |
| FNB | 250655 |
| Nedbank | 198765 |
| Standard Bank | 051001 |
| African Bank | 430000 |
| Investec | 580105 |
| TymeBank | 678910 |
| Discovery Bank | 679000 |
| Bidvest Bank | 462005 |

## MCP Tools (9 total)

### Data Tools

| # | Tool | Description |
|---|---|---|
| 1 | `fetch_client_data` | Fetch a single client row from the Google Sheet |
| 2 | `list_clients` | List clients with summary info (name, row number) |
| 9 | `update_cell` | Write a value to any cell (e.g. set status to "Uploaded") |

### Automation Tools

| # | Tool | Description |
|---|---|---|
| 3 | `login_mmx` | Log into MMX Systems with persistent session |
| 4 | `fill_client_search` | Select Domestic, pick product, click New Client |
| 5 | `fill_client_info` | Fill Client tab: name, ID, phone, email, address, inception date |
| 6 | `fill_policy_info` | Fill Policy Info sub-tab: NPC company, frequency, dates |
| 7 | `fill_bank_details` | Fill Bank Details sub-tab: holder, account, branch, collection day, account type |
| 8 | `file_submission` | Click File button on the Policy tab |
| 9 | `fill_cover_tab` | Click Donation row, add item, enter amount, File |

## Required Execution Sequence

Each tab **must** be filed/saved individually before proceeding to the next. The Cover tab will show a "CRITICAL INPUT" modal if Client or Policy tabs are not filed first.

```
1. fetch_client_data (row N)
2. login_mmx
3. fill_client_search (Domestic, GW6 product)
4. fill_client_info (...) --> file Client tab
5. fill_policy_info (...) + fill_bank_details (...) --> file Policy tab
6. fill_cover_tab (donation amount)
7. update_cell (row N, col A, "Uploaded")
```

## Key Technical Constraints

### Payment Method Select (#txt28)
The ASP.NET `onchange` handler (`doValidation(28); runAfterSub(this);`) triggers CDV (Check Digit Verification) that resets the selected value within 100ms. The `xonblur="CDV"` attribute also resets on blur. Solution: remove the `onchange` handler via JavaScript before setting `selectedIndex`, and do not dispatch change/blur events. ASP.NET reads the DOM `selectedIndex` directly on form submission.

### Cover Tab Donation Fields
After clicking the Donation row and adding an item, the form presents:
- `#txt11` (Item) - editable, receives the donation amount
- `#txt1` (Section) - readonly formula field (`@SUM(3)+@SUM(11)`), must be set via JavaScript by temporarily removing the `readonly` attribute

### Branch Code Lookup
The branch code field triggers a search modal. The code must be numeric (e.g. `470010` for Capitec), not the bank name. The application maps bank names from the sheet to numeric codes automatically.

### Review Month (#txt26)
Disabled by default. Must be enabled via JavaScript (`removeAttribute("disabled")`) before setting a value. Auto-calculated as the month after the inception month.

## Configuration

Environment variables (`.env` file in project root):

```
MMX_USERNAME=CIVFRABA
MMX_PASSWORD="password_here"
MMX_BASE_URL=https://www.mmxsystems.co.za
GOOGLE_SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
HEADLESS=false
USER_DATA_DIR=./user-data-2
NAVIGATION_TIMEOUT=30000
ACTION_TIMEOUT=10000
```

## Error Handling

- On any step failure, the full error message (truncated to 500 chars) is written to Column A of the corresponding Google Sheet row
- Each automation function returns `{ success: boolean, message: string }`
- The `withRetry` utility retries failed operations up to 2 times
- Modal dialogs (CDV warnings, search overlays, message modals) are automatically dismissed

## File Structure

```
src/
  index.ts                    # MCP server, 9 tool definitions
  config.ts                   # Environment config loader
  types.ts                    # TypeScript type definitions
  automation/
    browser-manager.ts        # Singleton persistent Playwright context
    login.ts                  # MMX login automation
    client-search.ts          # New Client form navigation
    client-info.ts            # Client tab field filling
    policy-info.ts            # Policy Info sub-tab
    bank-details.ts           # Bank Details sub-tab (CDV-safe)
    file-tab.ts               # Generic tab filing (Client/Policy)
    cover-tab.ts              # Cover tab: Donation -> amount -> File
    finalize.ts               # Legacy wrapper around filePolicyTab()
  sheets/
    client.ts                 # Google Sheet read/write operations
  utils/
    logger.ts                 # stderr-only logging (MCP stdio safe)
    retry.ts                  # Retry wrapper with configurable attempts
test-flow.mjs                 # End-to-end test script
build/                        # Compiled JS output (tsc)
user-data-2/                  # Persistent browser profile
.env                          # Credentials and config
```

## Future Work

1. **Auto-trigger on new rows** - Watch the Google Sheet for new rows with status "To be loaded" and automatically process them
2. **Multi-row batch processing** - Process all pending rows in sequence with a single command
3. **Headless mode** - Run without a visible browser window for server deployments
4. **Status dashboard** - Report on processed/failed/pending rows
