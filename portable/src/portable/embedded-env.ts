/**
 * Embedded defaults from the original .env — baked in at build time.
 * These become process.env values unless overridden by a sidecar .env
 * placed next to the exe.
 */
export const EMBEDDED_ENV: Record<string, string> = {
  MMX_USERNAME: "CIVFRABA",
  MMX_PASSWORD: "m8&x#O(dKw6Q",
  MMX_BASE_URL: "https://www.mmxsystems.co.za",

  GOOGLE_SHEET_WEBAPP_URL:
    "https://script.google.com/macros/s/AKfycbxN83hBHO8Q3SurDlo3t_A8THHEwhWBhdTEZc-2ySST6G5OYtr5EMYzcyBhG7AhmpXJVg/exec",

  COLUMN_MAPPING:
    '{"A":"status","B":"clientName","C":"clientSurname","D":"idNumber","E":"cellphone","F":"email","G":"address","H":"city","I":"province","J":"postalCode","K":"accountHolder","L":"bank","M":"accountNumber","N":"accountType","O":"contractAmount","P":"paymentFrequency","Q":"debitOrderDate","R":"dateSaleMade","S":"agent"}',

  HEADLESS: "false",
  NAVIGATION_TIMEOUT: "30000",
  ACTION_TIMEOUT: "10000",
  POLL_INTERVAL_MS: "30000",
  AUTO_START_POLLING: "false",
  DASHBOARD_PORT: "3000",
};
