import { log } from "../utils/logger.js";
import type { ColumnMapping, SheetRow, SheetClientSummary } from "../types.js";

function applyColumnMapping(
  rawData: Record<string, string>,
  mapping: ColumnMapping
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [colLetter, fieldName] of Object.entries(mapping)) {
    if (rawData[colLetter] !== undefined) {
      mapped[fieldName] = rawData[colLetter];
    }
  }
  return mapped;
}

export async function fetchClientRow(
  sheetUrl: string,
  rowNumber: number,
  columnMapping: ColumnMapping
): Promise<SheetRow> {
  const url = new URL(sheetUrl);
  url.searchParams.set("action", "getRow");
  url.searchParams.set("row", rowNumber.toString());

  log("info", `Fetching row ${rowNumber} from sheet`);

  const response = await fetch(url.toString(), { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Sheet API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { row: number; data: Record<string, string> };
  const mappedData = applyColumnMapping(json.data, columnMapping);

  log("info", `Row ${rowNumber} fetched successfully`, { fields: Object.keys(mappedData) });

  return { rowNumber, rawData: json.data, mappedData };
}

export async function listClients(
  sheetUrl: string,
  columnMapping: ColumnMapping,
  startRow: number = 2,
  endRow?: number
): Promise<SheetClientSummary[]> {
  const url = new URL(sheetUrl);
  url.searchParams.set("action", "list");
  url.searchParams.set("start", startRow.toString());
  if (endRow !== undefined) {
    url.searchParams.set("end", endRow.toString());
  }

  log("info", `Listing clients from row ${startRow}${endRow ? ` to ${endRow}` : ""}`);

  const response = await fetch(url.toString(), { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Sheet API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    rows: Array<{ row: number; data: Record<string, string> }>;
  };

  // Find the column letters that map to "clientName" and "product"
  const nameCol = Object.entries(columnMapping).find(([, v]) => v === "clientName")?.[0];
  const productCol = Object.entries(columnMapping).find(([, v]) => v === "product")?.[0];

  // Find the column letter that maps to "status"
  const statusCol = Object.entries(columnMapping).find(([, v]) => v === "status")?.[0];

  const summaries: SheetClientSummary[] = json.rows.map((r) => ({
    rowNumber: r.row,
    name: nameCol ? r.data[nameCol] || "Unknown" : "Unknown",
    product: productCol ? r.data[productCol] || "Unknown" : "Unknown",
    status: statusCol ? r.data[statusCol] || "" : "",
  }));

  log("info", `Listed ${summaries.length} clients`);
  return summaries;
}

export async function updateCell(
  sheetUrl: string,
  row: number,
  col: string,
  value: string
): Promise<{ success: boolean; message: string }> {
  const url = new URL(sheetUrl);
  url.searchParams.set("action", "updateCell");
  url.searchParams.set("row", row.toString());
  url.searchParams.set("col", col);
  url.searchParams.set("value", value);

  log("info", `Updating cell ${col}${row} to "${value}"`);

  const response = await fetch(url.toString(), { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Sheet API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { success: boolean; message?: string };

  if (!json.success) {
    throw new Error(json.message || "Failed to update cell");
  }

  log("info", `Cell ${col}${row} updated to "${value}"`);
  return { success: true, message: `Cell ${col}${row} updated to "${value}"` };
}
