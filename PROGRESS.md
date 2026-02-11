# MMX MCP Server - Progress Log

## Project Overview
MCP server that reads client data from Google Sheets and fills MMX Systems insurance forms via Playwright.

## Architecture Discovered

### Page Structure After Login
```
login.aspx (main page - URL never changes)
  └── contentframe (frame name="contentframe")
        ├── ClientSearch.aspx (initial page after login)
        │     Tabs: Search | New | History
        │     New tab: Domestic/Commercial radio → Product dropdown → New Client button
        │
        └── After "New Client" click, contentframe reloads with:
              Tabs: Client | Policy | Cover | Schedule comments | Confidential comments | Premium summary
              ├── ifrmClient (visible by default)
              ├── ifrmPolicy (visible when Policy tab clicked)
              │     Sub-tabs: Policy info (#tabli0) | Bank details (#tabli1)
              │     Policy info fields: #txt5 (NPC code), #txt15 (freq), #txt17 (inception), etc.
              │     Bank details fields: #txt32 (holder), #txt31 (acct#), #txt30 (branch), etc.
              │     File button: #btnSave
              ├── ifrmCover (about:blank until activated)
              ├── ifrmComments (about:blank)
              ├── ifrmConfidential (about:blank)
              └── ifrmPremiumSummary (about:blank)
```

### Key Findings
- **URL never changes** after login - stays on `login.aspx`. Success detected by login form disappearing.
- **All content is in frames** - `contentframe` holds everything, sub-iframes for each tab.
- **NPC code field (#txt5)** triggers a `#modalSearch` dialog on Tab/blur - must dismiss/handle before continuing.
- **Honeypot button** on login page: `input[name="HAHA"]` - must use `input[name="loginButton"]`.
- **Password field** is `type="text"` not `type="password"`.
- **dotenv `#` character**: Password containing `#` must be quoted in `.env`.

## Completed Steps

### Step 0: Fetch Client Data ✅
- Google Apps Script web app fetches from Google Sheets
- Uses `SpreadsheetApp.openById()` (not `getActiveSpreadsheet()` which returns null)
- Sheet ID: `1AS-S0XLWgwG8bBhYGoC0plDxoB0UKPa8YOtsb8obxPE`
- Supports: `getRow`, `list`, `updateCell` actions

### Step 1: Login ✅
- Always navigates to `login.aspx` first (never skips)
- Fills `#txtUsername` and `#txtPassword`
- Clicks `input[name="loginButton"]` (NOT the honeypot `HAHA` button)
- Success detected by: login form disappearing (NOT URL change)

### Step 2: Client Search ✅
- Accesses `contentframe` (frame name, not CSS selector)
- Clicks "New" tab: `a[href="#tabsNew"]`
- Selects Domestic radio: `#rblDomesticCommercial_0`
- Waits 2s for product dropdown
- Selects product from `#ddlProductCodes`
- Clicks `#btnNewClient`

### Step 3: Policy Info - PARTIAL ✅/❌
- Clicks Policy tab: `a[href="#tabsPolicy"]` in contentframe
- Accesses `#ifrmPolicy` via `contentFrame.frameLocator("#ifrmPolicy")`
- Clicks Policy Info sub-tab: `#tabli0`
- ✅ NPC company code (#txt5): fills successfully
- ✅ Payment frequency (#txt15): selects successfully
- ❌ Inception date (#txt17): BLOCKED by `#modalSearch` dialog
  - The Tab key on #txt5 triggers a search modal overlay
  - Need to dismiss `#modalSearch` before continuing

### Step 4: Bank Details - Not tested yet
### Step 5: File Submission - Not tested yet
### Step 6: Update Cell A2 - Not tested yet

## Current Blocker
**`#modalSearch` dialog** appears inside `#ifrmPolicy` after NPC code Tab.
- Element: `<div id="modalSearch" class="modal fade ui-draggable in">`
- It intercepts all pointer events on the form fields below it.
- Need to either:
  1. Close/dismiss the modal after NPC code entry
  2. Select the NPC value from the modal search results
  3. Use `{ force: true }` to bypass the modal overlay

## Files Modified
- `src/automation/login.ts` - Rewrote for always-login-first + frame-based success detection
- `src/automation/client-search.ts` - Uses contentframe instead of direct navigation
- `src/automation/policy-info.ts` - Goes through contentframe → Policy tab → ifrmPolicy
- `src/automation/bank-details.ts` - Same frame path as policy-info
- `src/automation/finalize.ts` - Same frame path
- `src/sheets/client.ts` - Added updateCell function
- `src/index.ts` - Added update_cell MCP tool (#8)
- `.env` - Password quoted, new sheet URL, USER_DATA_DIR=user-data-2
- `code.gs` - Google Apps Script with openById fix

## Environment
- Playwright persistent context: `user-data-2/`
- Browser: Chromium (headless=false for debugging)
- Build: `npm run build` (tsc)
- Test: `node test-flow.mjs`

## Pending
- [ ] Fix #modalSearch dismissal after NPC code entry
- [ ] Complete Policy Info fields (inception/expiry/review dates)
- [ ] Test Bank Details
- [ ] Test File submission
- [ ] Update cell A2 to "Uploaded" on success
- [ ] Implement auto-trigger for new sheet rows (user requirement)
