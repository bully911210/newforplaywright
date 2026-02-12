// CRITICAL: For stdio MCP servers, NEVER use console.log (stdout).
// All logging must go to stderr via console.error.

import { EventEmitter } from "node:events";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: unknown;
}

/** Singleton emitter — dashboard SSE subscribes to "log" and "status" events */
export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

/** Circular buffer of recent logs so new SSE clients get immediate context */
const LOG_BUFFER_SIZE = 200;
const recentLogs: LogEntry[] = [];

export function getRecentLogs(): LogEntry[] {
  return [...recentLogs];
}

export function log(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  data?: unknown
): void {
  const timestamp = new Date().toISOString();

  // Always write to stderr first (MCP requirement)
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (data !== undefined) {
    console.error(entry, typeof data === "string" ? data : JSON.stringify(data));
  } else {
    console.error(entry);
  }

  // Broadcast to SSE subscribers
  const logEntry: LogEntry = { timestamp, level, message, data };
  recentLogs.push(logEntry);
  if (recentLogs.length > LOG_BUFFER_SIZE) {
    recentLogs.shift();
  }
  logEmitter.emit("log", logEntry);
}
