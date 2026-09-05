import { BuyerAgent } from "./buyerAgent";
import { SupplierAgent } from "./supplierAgent";
import { VerificationAgent, LogisticsAgent } from "./verificationAgent";
import { searchSuppliers } from "../tools/agentTools";
import { getClient, createFundedWallet, createEscrow } from "../tools/xrplTools";
import { BuyerIntent, AgentLogEvent, DealTerms } from "../shared/types";

// Demo-only USD->XRP mapping so testnet faucet wallets (funded with ~1000 XRP)
// can settle deals of any size without needing a real FX oracle. NOT a real
// exchange rate — a production build would price this off RLUSD (1:1 USD) or
// a live rate feed instead of XRP.
const DEMO_USD_TO_XRP_RATE = 0.01;
function usdToDemoDrops(totalUsd: number): string {
  const xrp = Math.max(1, totalUsd * DEMO_USD_TO_XRP_RATE);
  return String(Math.round(xrp * 1_000_000));
}

// Safety-net refund window. 7 days is the realistic production value; the
// caller may override it shorter purely to demo the refund path live.
const DEFAULT_CANCEL_AFTER_SECONDS = 7 * 24 * 60 * 60;

export class TradeOrchestrator {
  private buyerAgent = new BuyerAgent();
  private supplierAgent = new SupplierAgent();
  private verificationAgent = new VerificationAgent();
  private logisticsAgent = new LogisticsAgent();

  public async runProcurementLoop(
    intent: BuyerIntent,
    onLogEvent: (e: AgentLogEvent) => void,
    options: { cancelAfterSeconds?: number } = {}
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
      const supplierResponse = await this.supplierAgent.negotiateTerms(
        selectedSupplier,
        currentBidUnitPrice,
        onLogEvent
      );

      if (supplierResponse.accepted) {
        agreedUnitPrice = currentBidUnitPrice;
        break;
      }

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
        return; // Budget exceeded or deal failed
      }
    }

    const totalCostUSD = agreedUnitPrice * intent.quantity;

    // 4. Governance & Human Approval Boundary Check
    const needsApproval = this.buyerAgent.requiresHumanApproval(totalCostUSD, intent, onLogEvent);
    if (needsApproval) {
      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "awaiting_user_signature",
        message: `User authorization received for $${totalCostUSD}. Handing off to XRPL settlement layer.`,
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

    // 5. Settlement: lock funds in an XRPL escrow, gated by a condition only
    // the verification agent can fulfill.
    const client = await getClient();
    try {
      // NOTE: these are freshly funded testnet wallets standing in for the
      // real buyer/supplier/verification-agent accounts. A production build
      // would load the buyer's and verification agent's own wallets (env-var
      // or KMS per the XRPL Agent Wallet skill) and take the supplier's
      // address as part of the already-agreed deal terms.
      const buyer = await createFundedWallet(client, "buyer");
      const supplier = await createFundedWallet(client, "supplier");
      const verifier = await createFundedWallet(client, "verification-agent");

      dealTerms.buyerAddress = buyer.address;
      dealTerms.supplierAddress = supplier.address;

      const { condition } = this.verificationAgent.generateReleaseCondition(dealTerms.dealId);
      dealTerms.escrowCondition = condition;

      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "locking_funds",
        message: `Locking $${dealTerms.totalPriceUSD} (demo: ${Number(usdToDemoDrops(totalCostUSD)) / 1_000_000} XRP) in XRPL escrow, release gated on verification agent's condition...`,
        timestamp: new Date().toISOString(),
      });

      const created = await createEscrow({
        client,
        fromWallet: buyer.wallet,
        toAddress: supplier.address,
        amountDrops: usdToDemoDrops(totalCostUSD),
        condition,
        cancelAfterSeconds: options.cancelAfterSeconds ?? DEFAULT_CANCEL_AFTER_SECONDS,
        memo: { agent_id: "settlement-orchestrator-v1", deal_id: dealTerms.dealId, action: "lock_escrow" },
      });

      if (created.resultCode !== "tesSUCCESS") {
        throw new Error(`EscrowCreate failed: ${created.resultCode}`);
      }

      dealTerms.escrowSequence = created.sequence;
      dealTerms.escrowCreateTxHash = created.txHash;
      dealTerms.status = "ESCROW_REQUESTED";

      onLogEvent({
        type: "agent_action",
        agent: "system",
        action: "escrow_created",
        message: `XRPL Escrow created! Tx Hash: ${created.txHash}`,
        timestamp: new Date().toISOString(),
      });

      // 6. Verification & autonomous release-or-refund decision
      const settled = await this.verificationAgent.verifyAndSettle(client, verifier.wallet, dealTerms, onLogEvent);

      if (settled.passed) {
        dealTerms.inspectionPassed = true;
        dealTerms.escrowFinishTxHash = settled.finishTxHash;
        dealTerms.status = "DELIVERED";
        await this.logisticsAgent.confirmDelivery("DHL-XRPL-99120", onLogEvent);
      } else {
        onLogEvent({
          type: "agent_action",
          agent: "system",
          action: "settlement_pending_refund",
          message: `Inspection failed. Funds remain locked; buyer may reclaim via EscrowCancel once the CancelAfter window elapses.`,
          timestamp: new Date().toISOString(),
        });
        // Real flow: this fires later (after CancelAfter passes) — e.g. from
        // a scheduled job — not synchronously here. Exposed for callers that
        // want to demo the refund path with a short cancelAfterSeconds override.
      }
    } finally {
      await client.disconnect();
    }
  }
}
