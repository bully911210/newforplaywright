import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logEmitter, getRecentLogs } from "../utils/logger.js";
import type { LogEntry } from "../utils/logger.js";
import { getRunHistory, getCurrentRun } from "./run-history.js";
import type { RunRecord } from "./run-history.js";
import { startPolling, stopPolling, isPolling } from "../automation/poll-sheet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, "../../screenshots");

// Resolve HTML path — works from both src/ and build/ directories
function findDashboardHTML(): string {
  // First try alongside compiled JS (build/dashboard/)
  const sameDirPath = path.resolve(__dirname, "dashboard.html");
  if (fs.existsSync(sameDirPath)) return sameDirPath;
  // Fallback to src/dashboard/
  const srcPath = path.resolve(__dirname, "../../src/dashboard/dashboard.html");
  if (fs.existsSync(srcPath)) return srcPath;
  return sameDirPath; // will 500 if not found
}

let server: http.Server | null = null;

export function startDashboard(port: number): void {
  if (server) {
    log("warn", "Dashboard server already running");
    return;
  }

  server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");

    try {
      if (pathname === "/" || pathname === "/index.html") {
        serveHTML(res);
      } else if (pathname === "/api/events") {
        serveSSE(req, res);
      } else if (pathname === "/api/runs" && req.method === "GET") {
        serveJSON(res, { runs: getRunHistory(), current: getCurrentRun() });
      } else if (pathname === "/api/status" && req.method === "GET") {
        serveJSON(res, { polling: isPolling(), currentRun: getCurrentRun() });
      } else if (pathname === "/api/polling/start" && req.method === "POST") {
        const result = startPolling();
        serveJSON(res, result);
      } else if (pathname === "/api/polling/stop" && req.method === "POST") {
        const result = stopPolling();
        serveJSON(res, result);
      } else if (pathname.startsWith("/screenshots/")) {
        serveScreenshot(res, pathname);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    } catch (err) {
      log("error", `Dashboard request error: ${err}`);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    log("info", `Dashboard running at http://localhost:${port}`);
  });
}

export function stopDashboard(): void {
  if (server) {
    server.close();
    server = null;
    log("info", "Dashboard server stopped");
  }
}

function serveHTML(res: http.ServerResponse): void {
  try {
    const html = fs.readFileSync(findDashboardHTML(), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Dashboard HTML not found");
  }
}

function serveJSON(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Send recent log buffer so new clients get context
  for (const entry of getRecentLogs()) {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  }

  // Send current status
  res.write(
    `event: status\ndata: ${JSON.stringify({
      state: isPolling() ? "polling" : "idle",
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  // Live listeners
  const onLog = (entry: LogEntry) => {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  };

  const onStatus = (status: { state: string; detail?: string }) => {
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
  };

  const onRun = (_run: RunRecord) => {
    res.write(`event: run\ndata: ${JSON.stringify(_run)}\n\n`);
  };

  logEmitter.on("log", onLog);
  logEmitter.on("status", onStatus);
  logEmitter.on("run", onRun);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30_000);

  // Cleanup on disconnect
  req.on("close", () => {
    logEmitter.off("log", onLog);
    logEmitter.off("status", onStatus);
    logEmitter.off("run", onRun);
    clearInterval(heartbeat);
  });
}

function serveScreenshot(res: http.ServerResponse, pathname: string): void {
  const filename = path.basename(pathname);
  if (!filename.endsWith(".png") || filename.includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const filePath = path.join(SCREENSHOT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Screenshot not found");
    return;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": data.length,
    "Cache-Control": "public, max-age=86400",
  });
  res.end(data);
}
