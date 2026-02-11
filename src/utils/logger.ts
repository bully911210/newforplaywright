// CRITICAL: For stdio MCP servers, NEVER use console.log (stdout).
// All logging must go to stderr via console.error.

export function log(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  data?: unknown
): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    console.error(entry, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.error(entry);
  }
}
