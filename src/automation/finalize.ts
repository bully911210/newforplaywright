import { filePolicyTab } from "./file-tab.js";
import type { ToolResult } from "../types.js";

/**
 * File the Policy tab. This is a thin wrapper around filePolicyTab()
 * kept for backwards compatibility with the MCP tool interface.
 */
export async function finalizeSubmission(
  confirmSubmit: boolean
): Promise<ToolResult> {
  if (!confirmSubmit) {
    return {
      success: false,
      message: "Submission not confirmed. Set confirmSubmit to true to proceed.",
    };
  }

  return filePolicyTab();
}
