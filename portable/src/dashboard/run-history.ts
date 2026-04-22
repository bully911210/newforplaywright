import { logEmitter } from "../utils/logger.js";

export type RunStatus = "running" | "success" | "failed";

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowLabel: string;
  rowNumber: number;
  clientName: string;
  status: RunStatus;
  currentStep: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  screenshotPath: string | null;
}

const MAX_HISTORY = 100;
const runs: RunRecord[] = [];
let runCounter = 0;

export function startRun(opts: {
  workflowId: string;
  workflowLabel: string;
  rowNumber: number;
  clientName: string;
}): RunRecord {
  const run: RunRecord = {
    id: String(++runCounter),
    workflowId: opts.workflowId,
    workflowLabel: opts.workflowLabel,
    rowNumber: opts.rowNumber,
    clientName: opts.clientName,
    status: "running",
    currentStep: "init",
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    error: null,
    screenshotPath: null,
  };
  runs.unshift(run);
  if (runs.length > MAX_HISTORY) runs.pop();
  logEmitter.emit("run", run);
  return run;
}

export function updateRunStep(id: string, step: string): void {
  const run = runs.find((r) => r.id === id);
  if (run) {
    run.currentStep = step;
    logEmitter.emit("run", run);
  }
}

export function completeRun(
  id: string,
  result: { success: boolean; error?: string; screenshotPath?: string }
): void {
  const run = runs.find((r) => r.id === id);
  if (!run) return;
  run.status = result.success ? "success" : "failed";
  run.completedAt = new Date().toISOString();
  run.durationMs =
    new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  run.error = result.error ?? null;
  run.screenshotPath = result.screenshotPath ?? null;
  logEmitter.emit("run", run);
}

export function getRunHistory(): RunRecord[] {
  return runs;
}

export function getCurrentRun(): RunRecord | null {
  return runs.find((r) => r.status === "running") ?? null;
}
