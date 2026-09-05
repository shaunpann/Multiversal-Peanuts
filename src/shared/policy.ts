// src/shared/policy.ts
//
// The spending control for autonomous agent payments.
//
// This runs inside the payment path, below the agent — so a model cannot
// reason or be prompted past a limit. A system prompt saying "stay under
// budget" is not a control; this is. The second control is the agent's own
// funded XRPL account (see x402/wallets.ts): whatever it decides, it can
// never spend more than that balance.

import { AgentLogEvent } from "./types";

export interface Receipt {
  service: string;
  priceXrp: number;
  txHash: string;
  /** What the purchased information changed about the agent's decision. */
  impact: string;
  timestamp: string;
}

export interface SpendPolicy {
  perCallMaxXrp: number;
  perDealMaxXrp: number;
  /** At or below this the agent pays unattended; above it a human is asked. */
  autoApproveMaxXrp: number;
  allowedServices: string[];
  maxCallsPerDeal: number;
}

export const DEFAULT_POLICY: SpendPolicy = {
  perCallMaxXrp: 0.5,
  perDealMaxXrp: 2.0,
  autoApproveMaxXrp: 0.5,
  allowedServices: ["verify-business", "freight-quote", "customs-check"],
  maxCallsPerDeal: 20,
};

export type PolicyVerdict =
  | { decision: "allow" }
  | { decision: "escalate"; reason: string }
  | { decision: "deny"; reason: string };

export class PolicyEngine {
  private receipts: Receipt[] = [];

  constructor(
    public readonly policy: SpendPolicy = DEFAULT_POLICY,
    private readonly emit: (e: AgentLogEvent) => void = () => {},
  ) {}

  get spentXrp(): number {
    return Number(this.receipts.reduce((t, r) => t + r.priceXrp, 0).toFixed(6));
  }

  get callCount(): number {
    return this.receipts.length;
  }

  check(serviceId: string, priceXrp: number): PolicyVerdict {
    if (!this.policy.allowedServices.includes(serviceId)) {
      return { decision: "deny", reason: `'${serviceId}' is not on the service allowlist` };
    }
    if (this.callCount >= this.policy.maxCallsPerDeal) {
      return { decision: "deny", reason: `call limit reached (${this.policy.maxCallsPerDeal})` };
    }
    if (priceXrp > this.policy.perCallMaxXrp) {
      return { decision: "deny", reason: `${priceXrp} XRP exceeds the ${this.policy.perCallMaxXrp} XRP per-call cap` };
    }
    if (this.spentXrp + priceXrp > this.policy.perDealMaxXrp) {
      return { decision: "deny", reason: `would exceed the ${this.policy.perDealMaxXrp} XRP budget for this deal` };
    }
    if (priceXrp > this.policy.autoApproveMaxXrp) {
      return {
        decision: "escalate",
        reason: `${priceXrp} XRP is above the ${this.policy.autoApproveMaxXrp} XRP auto-approval threshold`,
      };
    }
    return { decision: "allow" };
  }

  record(receipt: Receipt): void {
    this.receipts.push(receipt);
    this.emit({
      type: "agent_action",
      agent: "system",
      action: "budget_updated",
      message: `Agent has spent ${this.spentXrp} of its ${this.policy.perDealMaxXrp} XRP budget across ${this.callCount} paid calls.`,
      timestamp: new Date().toISOString(),
      data: { spentXrp: this.spentXrp, callCount: this.callCount, receipts: this.receipts },
    });
  }

  ledger(): Receipt[] {
    return [...this.receipts];
  }
}
