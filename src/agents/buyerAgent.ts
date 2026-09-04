import { AgentLogEvent, BuyerIntent, SupplierQuote, DealTerms } from "../shared/types";

export class BuyerAgent {
  /**
   * Calculates an initial bidding strategy based on buyer intent.
   */
  public generateInitialBid(intent: BuyerIntent, emitEvent: (e: AgentLogEvent) => void): number {
    // Start bid slightly below target to leave room for negotiation
    const initialBidUnitPrice = Math.round(intent.maxTargetUnitCostUSD * 0.9 * 100) / 100;

    emitEvent({
      type: "agent_action",
      agent: "buyer",
      action: "formulating_strategy",
      message: `Buyer Agent calculated opening strategy: Offering $${initialBidUnitPrice}/unit (Target: $${intent.maxTargetUnitCostUSD}/unit)`,
      timestamp: new Date().toISOString(),
    });

    return initialBidUnitPrice;
  }

  /**
   * Evaluates a supplier quote/counter-offer against the buyer's policy rules.
   */
  public evaluateSupplierOffer(
    quotePriceUnitPriceUSD: number,
    intent: BuyerIntent,
    emitEvent: (e: AgentLogEvent) => void
  ): { Accept: boolean; NextBidUnitPriceUSD?: number; Reason: string } {
    const totalCost = quotePriceUnitPriceUSD * intent.quantity;

    // Rule 1: Exceeds hard budget ceiling
    if (totalCost > intent.maxBudgetUSD) {
      emitEvent({
        type: "agent_action",
        agent: "buyer",
        action: "policy_check_failed",
        message: `Offer $${quotePriceUnitPriceUSD}/unit ($${totalCost} total) exceeds hard budget ceiling of $${intent.maxBudgetUSD}. Rejecting.`,
        timestamp: new Date().toISOString(),
      });
      return { Accept: false, Reason: "EXCEEDS_BUDGET" };
    }

    // Rule 2: At or below target unit cost -> Accept!
    if (quotePriceUnitPriceUSD <= intent.maxTargetUnitCostUSD) {
      emitEvent({
        type: "agent_action",
        agent: "buyer",
        action: "policy_check_passed",
        message: `Offer $${quotePriceUnitPriceUSD}/unit meets target threshold ($${intent.maxTargetUnitCostUSD}/unit). Accepting terms!`,
        timestamp: new Date().toISOString(),
      });
      return { Accept: true, Reason: "TARGET_MET" };
    }

    // Rule 3: Above target, but within budget -> Generate counter-offer
    const nextBid = Math.round(((quotePriceUnitPriceUSD + intent.maxTargetUnitCostUSD) / 2) * 100) / 100;

    emitEvent({
      type: "agent_action",
      agent: "buyer",
      action: "counter_bidding",
      message: `Supplier quote $${quotePriceUnitPriceUSD}/unit is above target. Formulating counter-bid at $${nextBid}/unit.`,
      timestamp: new Date().toISOString(),
    });

    return { Accept: false, NextBidUnitPriceUSD: nextBid, Reason: "COUNTER_OFFER" };
  }

  /**
   * Checks if the transaction requires human signoff based on spending limits.
   */
  public requiresHumanApproval(totalPriceUSD: number, intent: BuyerIntent, emitEvent: (e: AgentLogEvent) => void): boolean {
    if (totalPriceUSD > intent.autoApproveLimitUSD) {
      emitEvent({
        type: "agent_action",
        agent: "buyer",
        action: "human_approval_required",
        message: `Deal total ($${totalPriceUSD}) exceeds autonomous limit ($${intent.autoApproveLimitUSD}). Pausing for human authorization...`,
        timestamp: new Date().toISOString(),
      });
      return true;
    }
    
    emitEvent({
      type: "agent_action",
      agent: "buyer",
      action: "auto_approved",
      message: `Deal total ($${totalPriceUSD}) within autonomous limit ($${intent.autoApproveLimitUSD}). Proceeding to settlement.`,
      timestamp: new Date().toISOString(),
    });

    return false;
  }
}