import { AgentLogEvent, SupplierQuote } from "../shared/types";

export class SupplierAgent {
  private minimumUnitPriceUSD: number = 29.5; // Profit margin walkaway limit

  public async negotiateTerms(
    quote: SupplierQuote,
    buyerOfferUnitPriceUSD: number,
    emitEvent: (e: AgentLogEvent) => void
  ): Promise<{ accepted: boolean; counterOfferUnitPriceUSD: number; message: string }> {
    
    emitEvent({
      type: "agent_action",
      agent: "supplier",
      action: "evaluating_bid",
      message: `Supplier ${quote.supplierName} evaluating buyer offer of $${buyerOfferUnitPriceUSD}/unit`,
      timestamp: new Date().toISOString(),
    });

    if (buyerOfferUnitPriceUSD >= quote.unitPriceUSD) {
      return { accepted: true, counterOfferUnitPriceUSD: buyerOfferUnitPriceUSD, message: "Offer accepted instantly." };
    }

    if (buyerOfferUnitPriceUSD >= this.minimumUnitPriceUSD) {
      const counter = Math.round(((buyerOfferUnitPriceUSD + quote.unitPriceUSD) / 2) * 100) / 100;
      
      emitEvent({
        type: "agent_action",
        agent: "supplier",
        action: "counter_offer",
        message: `Supplier counter-offered $${counter}/unit (Total: $${counter * quote.quantity})`,
        timestamp: new Date().toISOString(),
      });

      return { accepted: false, counterOfferUnitPriceUSD: counter, message: "Counter offer made." };
    }

    return {
      accepted: false,
      counterOfferUnitPriceUSD: quote.unitPriceUSD,
      message: "Bid is below acceptable margin limit.",
    };
  }
}