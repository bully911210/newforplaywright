import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import type { ColumnMapping } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export interface Config {
  mmxUsername: string;
  mmxPassword: string;
  mmxBaseUrl: string;

  googleSheetWebAppUrl: string;
  columnMapping: ColumnMapping;

  headless: boolean;
  userDataDir: string;

  navigationTimeout: number;
  actionTimeout: number;

  pollIntervalMs: number;
  autoStartPolling: boolean;
}

let configCache: Config | null = null;

export function getConfig(): Config {
  if (configCache) return configCache;

  configCache = {
    mmxUsername: process.env.MMX_USERNAME || "",
    mmxPassword: process.env.MMX_PASSWORD || "",
    mmxBaseUrl: process.env.MMX_BASE_URL || "https://www.mmxsystems.co.za",

    googleSheetWebAppUrl: process.env.GOOGLE_SHEET_WEBAPP_URL || "",

    columnMapping: process.env.COLUMN_MAPPING
      ? JSON.parse(process.env.COLUMN_MAPPING)
      : {},

    headless: process.env.HEADLESS === "true",
    userDataDir: process.env.USER_DATA_DIR || path.resolve(__dirname, "../user-data"),

    navigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT || "30000"),
    actionTimeout: parseInt(process.env.ACTION_TIMEOUT || "10000"),

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "30000"),
    autoStartPolling: process.env.AUTO_START_POLLING === "true",
  };

  return configCache;
}
