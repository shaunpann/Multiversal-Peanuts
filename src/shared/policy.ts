import type { Receipt, SpendPolicy } from "./types.js";
import { bus } from "./events.js";

export const DEFAULT_POLICY: SpendPolicy = {
  perCallMaxXrp: 0.5,
  perDealMaxXrp: 2.0,
  autoApproveMaxXrp: 0.5,
  allowedServices: ["verify-business", "inspection", "freight-quote", "customs-check"],
  maxCallsPerDeal: 20,
};

export type PolicyVerdict =
  | { decision: "allow" }
  | { decision: "escalate"; reason: string }
  | { decision: "deny"; reason: string };

/**
 * The spending control. This runs in the payment path, below the agent, so the
 * model cannot argue its way past a limit: a prompt saying "stay under budget"
 * is not a control, this is.
 */
export class PolicyEngine {
  private receipts: Receipt[] = [];

  constructor(public policy: SpendPolicy = DEFAULT_POLICY) {}

  get spentXrp(): number {
    return Number(this.receipts.reduce((t, r) => t + r.priceXrp, 0).toFixed(6));
  }

  get callCount(): number {
    return this.receipts.length;
  }

  check(serviceId: string, priceXrp: number): PolicyVerdict {
    if (!this.policy.allowedServices.includes(serviceId)) {
      return { decision: "deny", reason: `service '${serviceId}' is not on the allowlist` };
    }
    if (this.callCount >= this.policy.maxCallsPerDeal) {
      return { decision: "deny", reason: `call limit reached (${this.policy.maxCallsPerDeal})` };
    }
    if (priceXrp > this.policy.perCallMaxXrp) {
      return {
        decision: "deny",
        reason: `${priceXrp} XRP exceeds the ${this.policy.perCallMaxXrp} XRP per-call limit`,
      };
    }
    if (this.spentXrp + priceXrp > this.policy.perDealMaxXrp) {
      return {
        decision: "deny",
        reason: `would exceed the ${this.policy.perDealMaxXrp} XRP budget for this deal`,
      };
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
    bus.emitEvent(
      "policy",
      "budget_updated",
      `Spent ${this.spentXrp} / ${this.policy.perDealMaxXrp} XRP across ${this.callCount} calls`,
      { data: { spentXrp: this.spentXrp, callCount: this.callCount } },
    );
  }

  ledger(): Receipt[] {
    return [...this.receipts];
  }

  reset(): void {
    this.receipts = [];
  }
}

export const policyEngine = new PolicyEngine();
