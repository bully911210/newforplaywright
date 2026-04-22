export interface SheetRow {
  rowNumber: number;
  rawData: Record<string, string>;
  mappedData: Record<string, string>;
}

export interface SheetClientSummary {
  rowNumber: number;
  name: string;
  product: string;
  status: string;
}

export interface ColumnMapping {
  [columnLetter: string]: string;
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface FormFields {
  // Client Search
  clientType?: string;
  product?: string;

  // Policy Info
  npcCompanyCode?: string;
  paymentFrequency?: string;
  inceptionDate?: string;
  expiryDate?: string;
  reviewDate?: string;
  reviewMonth?: string;

  // Bank Details
  accountHolder?: string;
  accountNumber?: string;
  branchCode?: string;
  collectionDay?: string;
  paymentMethod?: string;
}
