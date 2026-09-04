import { BuyerAgent } from "./buyerAgent";
import { SupplierAgent } from "./supplierAgent";
import { VerificationAgent, LogisticsAgent } from "./verificationAgent";
import { searchSuppliers, evaluateInvoice } from "../tools/agentTools";
import { BuyerIntent, AgentLogEvent, DealTerms } from "../shared/types";

export class TradeOrchestrator {
  private buyerAgent = new BuyerAgent();
  private supplierAgent = new SupplierAgent();
  private verificationAgent = new VerificationAgent();
  private logisticsAgent = new LogisticsAgent();

  public async runProcurementLoop(
    intent: BuyerIntent,
    onLogEvent: (e: AgentLogEvent) => void,
    settlementApiUrl: string = "http://localhost:3001/api/settlement/create-escrow"
  ) {
    // 1. Discovery
    onLogEvent({
      type: "agent_action",
      agent: "buyer",
      action: "sourcing_suppliers",
      message: `Buyer Agent searching open networks for ${intent.productName}...`,
      timestamp: new Date().toISOString(),
    });

    const candidateSuppliers = await searchSuppliers(intent.productName);
    const selectedSupplier = candidateSuppliers[0];

    // 2. Buyer Strategy Formulation
    let currentBidUnitPrice = this.buyerAgent.generateInitialBid(intent, onLogEvent);
    let agreedUnitPrice = selectedSupplier.unitPriceUSD;

    // 3. Autonomous Negotiation Loop
    for (let round = 1; round <= 3; round++) {
      // Query Supplier
      const supplierResponse = await this.supplierAgent.negotiateTerms(
        selectedSupplier,
        currentBidUnitPrice,
        onLogEvent
      );

      if (supplierResponse.accepted) {
        agreedUnitPrice = currentBidUnitPrice;
        break;
      }

      // Buyer evaluates supplier's counter-offer
      const evaluation = this.buyerAgent.evaluateSupplierOffer(
        supplierResponse.counterOfferUnitPriceUSD,
        intent,
        onLogEvent
      );

      if (evaluation.Accept) {
        agreedUnitPrice = supplierResponse.counterOfferUnitPriceUSD;
        break;
      } else if (evaluation.NextBidUnitPriceUSD) {
        currentBidUnitPrice = evaluation.NextBidUnitPriceUSD;
      } else {
        // Budget exceeded or deal failed
        return;
      }
    }

    const totalCostUSD = agreedUnitPrice * intent.quantity;

    // 4. Governance & Human Approval Boundary Check
    const needsApproval = this.buyerAgent.requiresHumanApproval(totalCostUSD, intent, onLogEvent);
    if (needsApproval) {
      // In a real frontend, Person C presents an "Approve Deal" button
      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "awaiting_user_signature",
        message: `User authorization received for $${totalCostUSD}. Handing off to XRPL / x402 settlement layer.`,
        timestamp: new Date().toISOString(),
      });
    }

    const dealTerms: DealTerms = {
      dealId: `DEAL-${Date.now()}`,
      supplierName: selectedSupplier.supplierName,
      unitPriceUSD: agreedUnitPrice,
      quantity: intent.quantity,
      totalPriceUSD: totalCostUSD,
      deliveryDays: selectedSupplier.leadTimeDays,
      inspectionPassed: false,
      status: "TERMS_AGREED",
    };

    // 5. Hand off to Settlement API (Person B)
    try {
      const response = await fetch(settlementApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dealTerms),
      });
      const result = await response.json();

      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "escrow_created",
        message: `XRPL Escrow created! Tx Hash: ${result.txHash || "0xMOCK_HASH"}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "escrow_requested",
        message: `Sent deal terms to settlement layer. Locking $${dealTerms.totalPriceUSD} in XRPL Escrow.`,
        timestamp: new Date().toISOString(),
      });
    }

    // 6. Verification & Delivery
    const verified = await this.verificationAgent.verifyOrder(dealTerms.dealId, onLogEvent);
    if (verified) {
      await this.logisticsAgent.confirmDelivery("DHL-XRPL-99120", onLogEvent);
    }
  }
}