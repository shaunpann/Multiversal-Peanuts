/** Shared contract between the three components. Agree on this file first. */

export type Currency = "XRP";

export interface Milestone {
  id: string;
  label: string;
  /** Share of the deal value released when this milestone is satisfied. */
  pct: number;
  /** What the verification agent must see before the preimage is revealed. */
  evidence: string;
  /** Days from escrow creation until the buyer can reclaim the funds. */
  deadlineDays: number;
}

export interface Mandate {
  prompt: string;
  units: number;
  product: string;
  maxUnitPrice: number;
  deliveryDays: number;
  requireVerifiedSupplier: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  unitPrice: number;
  leadDays: number;
  /** Only discoverable by paying for verification - the agent cannot see this. */
  hidden: {
    registration: "active" | "lapsed";
    disputes: number;
    yearsTrading: number;
  };
}

export interface Quote {
  supplierId: string;
  unitPrice: number;
  units: number;
  total: number;
  leadDays: number;
  note: string;
}

export interface Deal {
  dealId: string;
  mandate: Mandate;
  supplierId: string;
  supplierName: string;
  buyerAddress: string;
  supplierAddress: string;
  /** Contract value in the buyer's currency, for display. */
  displayTotal: number;
  displayCurrency: string;
  /** What actually gets escrowed on the testnet ledger. */
  amountXrp: number;
  milestones: Milestone[];
  approvedByHuman: boolean;
  status: "negotiating" | "awaiting_approval" | "settling" | "active" | "complete" | "failed";
}

export interface EscrowRecord {
  dealId: string;
  milestoneId: string;
  label: string;
  pct: number;
  amountXrp: number;
  owner: string;
  destination: string;
  /** OfferSequence for EscrowFinish. */
  sequence: number;
  condition: string;
  cancelAfterIso: string;
  createTxHash: string;
  finishTxHash?: string;
  status: "locked" | "released" | "cancelled";
}

/** One paid API call the agent made on its own authority. */
export interface Receipt {
  id: string;
  service: string;
  priceXrp: number;
  txHash: string;
  requestHash: string;
  responseHash: string;
  /** What the purchased information changed about the agent's decision. */
  impact: string;
  ts: string;
}

export type EventActor =
  | "buyer_agent"
  | "supplier_agent"
  | "verification_agent"
  | "settlement"
  | "policy"
  | "human"
  | "system";

export interface AgentEvent {
  seq: number;
  ts: string;
  actor: EventActor;
  type: string;
  message: string;
  txHash?: string;
  explorerUrl?: string;
  data?: Record<string, unknown>;
}

export interface SpendPolicy {
  /** Hard ceiling for a single x402 call, in XRP. */
  perCallMaxXrp: number;
  /** Hard ceiling for everything the agent spends on one deal. */
  perDealMaxXrp: number;
  /** At or below this the agent pays unattended; above it a human is asked. */
  autoApproveMaxXrp: number;
  /** Only these service ids may be paid. */
  allowedServices: string[];
  maxCallsPerDeal: number;
}
