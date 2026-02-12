import { log } from "../utils/logger.js";

/**
 * Interface every workflow must implement.
 * A workflow takes an opaque "job" descriptor and runs it.
 */
export interface Workflow {
  /** Unique ID, e.g. "mmx", "client-onboard", "invoice-gen" */
  id: string;
  /** Human-readable label for the dashboard */
  label: string;
  /** Execute the workflow for a given job */
  execute(job: WorkflowJob): Promise<WorkflowResult>;
}

export interface WorkflowJob {
  identifier: number | string;
  displayName: string;
  params: Record<string, unknown>;
}

export interface WorkflowResult {
  success: boolean;
  message: string;
  screenshotPath?: string;
}

const workflows = new Map<string, Workflow>();

export function registerWorkflow(workflow: Workflow): void {
  if (workflows.has(workflow.id)) {
    log("warn", `Workflow "${workflow.id}" already registered, replacing.`);
  }
  workflows.set(workflow.id, workflow);
  log("info", `Workflow registered: ${workflow.id} (${workflow.label})`);
}

export function getWorkflow(id: string): Workflow | undefined {
  return workflows.get(id);
}

export function listWorkflows(): Workflow[] {
  return [...workflows.values()];
}
