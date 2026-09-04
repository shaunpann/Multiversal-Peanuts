export interface AgentLogEvent {
  type: "agent_action";
  agent: "buyer" | "supplier" | "verification" | "logistics" | "system";
  action: string;
  message: string;
  timestamp?: string;
  data?: any;
}

export interface BuyerIntent {
  productName: string;
  quantity: number;
  maxBudgetUSD: number;
  maxTargetUnitCostUSD: number;
  deadlineDays: number;
  autoApproveLimitUSD: number;
}

export interface SupplierQuote {
  supplierId: string;
  supplierName: string;
  unitPriceUSD: number;
  quantity: number;
  totalPriceUSD: number;
  leadTimeDays: number;
}

export interface DealTerms {
  dealId: string;
  supplierName: string;
  unitPriceUSD: number;
  quantity: number;
  totalPriceUSD: number;
  deliveryDays: number;
  inspectionPassed: boolean;
  status: "NEGOTIATING" | "TERMS_AGREED" | "ESCROW_REQUESTED" | "DELIVERED";
}