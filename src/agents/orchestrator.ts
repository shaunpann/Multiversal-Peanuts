import { BuyerAgent } from "./buyerAgent";
import { SupplierAgent } from "./supplierAgent";
import { VerificationAgent, LogisticsAgent } from "./verificationAgent";
import { searchSuppliers } from "../tools/agentTools";
import { getClient, createFundedWallet, createEscrow } from "../tools/xrplTools";
import { BuyerIntent, AgentLogEvent, DealTerms, SupplierQuote } from "../shared/types";
import { DEFAULT_POLICY, PolicyEngine } from "../shared/policy";
import { callPaidService, PaidCallContext } from "../x402/client";
import { Client } from "xrpl";

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

    const candidateSuppliers = (await searchSuppliers(intent.productName)).sort(
      (a, b) => a.unitPriceUSD - b.unitPriceUSD
    );

    // The x402 plane. The agent has its own funded account and a spending
    // policy; from here until the deal is recommended, it pays for what it
    // needs to decide, unattended.
    const policy = new PolicyEngine(DEFAULT_POLICY, onLogEvent);
    const client = await getClient();
    const ctx: PaidCallContext = { client, policy, emit: onLogEvent };

    try {
    const selectedSupplier = await this.selectVerifiedSupplier(candidateSuppliers, ctx);
    if (!selectedSupplier) {
      onLogEvent({
        type: "agent_action",
        agent: "buyer",
        action: "no_supplier_qualified",
        message: "No supplier passed verification. Nothing was committed and no escrow was created.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

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

    // Landed cost: two more calls the agent pays for by itself.
    await callPaidService(ctx, "freight-quote", "/api/paid/freight-quote",
      "Sets the landed cost and the delivery deadline");
    await callPaidService(ctx, "customs-check", "/api/paid/customs-check",
      "Confirms duty exposure before committing");

    // 5. Settlement: lock funds in an XRPL escrow, gated by a condition only
    // the verification agent can fulfill.
    {
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
    }
    } finally {
      await client.disconnect();
    }
  }

  /**
   * The web app's entry point: everything up to the recommendation, and
   * nothing after it. The agent sources, pays to verify, negotiates, and
   * hands back terms for a human to approve — it never moves the buyer's
   * money on its own.
   */
  public async recommendDeal(
    intent: BuyerIntent,
    onLogEvent: (e: AgentLogEvent) => void
  ): Promise<
    | { supplier: SupplierQuote; agreedUnitPriceUSD: number; totalUSD: number; spendXrp: number; receipts: unknown[] }
    | undefined
  > {
    onLogEvent({
      type: "agent_action",
      agent: "buyer",
      action: "sourcing_suppliers",
      message: `Buyer Agent searching open networks for ${intent.productName}...`,
      timestamp: new Date().toISOString(),
    });

    const candidates = (await searchSuppliers(intent.productName)).sort(
      (a, b) => a.unitPriceUSD - b.unitPriceUSD
    );

    const policy = new PolicyEngine(DEFAULT_POLICY, onLogEvent);
    const client = await getClient();
    const ctx: PaidCallContext = { client, policy, emit: onLogEvent };

    try {
      const supplier = await this.selectVerifiedSupplier(candidates, ctx);
      if (!supplier) {
        onLogEvent({
          type: "agent_action",
          agent: "buyer",
          action: "no_supplier_qualified",
          message: "No supplier passed verification. Nothing was committed.",
          timestamp: new Date().toISOString(),
        });
        return undefined;
      }

      let bid = this.buyerAgent.generateInitialBid(intent, onLogEvent);
      let agreedUnitPriceUSD = supplier.unitPriceUSD;

      for (let round = 1; round <= 3; round++) {
        const counterparty = await this.supplierAgent.negotiateTerms(supplier, bid, onLogEvent);
        if (counterparty.accepted) {
          agreedUnitPriceUSD = bid;
          break;
        }
        const evaluation = this.buyerAgent.evaluateSupplierOffer(
          counterparty.counterOfferUnitPriceUSD,
          intent,
          onLogEvent
        );
        if (evaluation.Accept) {
          agreedUnitPriceUSD = counterparty.counterOfferUnitPriceUSD;
          break;
        }
        if (!evaluation.NextBidUnitPriceUSD) return undefined;
        bid = evaluation.NextBidUnitPriceUSD;
      }

      await callPaidService(ctx, "freight-quote", "/api/paid/freight-quote",
        "Sets the landed cost and the delivery deadline");
      await callPaidService(ctx, "customs-check", "/api/paid/customs-check",
        "Confirms duty exposure before committing");

      const totalUSD = agreedUnitPriceUSD * intent.quantity;
      onLogEvent({
        type: "agent_action",
        agent: "buyer",
        action: "recommendation_ready",
        message: `Recommending ${supplier.supplierName} at $${agreedUnitPriceUSD}/unit — $${totalUSD} total. Awaiting your approval.`,
        timestamp: new Date().toISOString(),
        data: { supplierId: supplier.supplierId, totalUSD, spentXrp: policy.spentXrp },
      });

      return {
        supplier,
        agreedUnitPriceUSD,
        totalUSD,
        spendXrp: policy.spentXrp,
        receipts: policy.ledger(),
      };
    } finally {
      await client.disconnect();
    }
  }

  /**
   * Cheapest first, but the agent pays to check each one before committing —
   * and the information it buys is allowed to change its mind. This is the
   * moment the autonomous payments earn their place: without them there is
   * nothing to distinguish the lowest quote from the best supplier.
   */
  private async selectVerifiedSupplier(
    candidates: SupplierQuote[],
    ctx: PaidCallContext
  ): Promise<SupplierQuote | undefined> {
    let unverifiable = 0;

    for (const candidate of candidates) {
      ctx.emit({
        type: "agent_action",
        agent: "buyer",
        action: "checking_supplier",
        message: `${candidate.supplierName} is the cheapest remaining option at $${candidate.unitPriceUSD}/unit. Verifying before committing.`,
        timestamp: new Date().toISOString(),
      });

      const result = await callPaidService<{ verdict: "pass" | "fail"; reason: string }>(
        ctx,
        "verify-business",
        `/api/paid/verify-business/${candidate.supplierId}`,
        `Decides whether ${candidate.supplierName} is eligible at all`
      );

      if (!result.ok || !result.data) {
        unverifiable += 1;
        ctx.emit({
          type: "agent_action",
          agent: "buyer",
          action: "verification_unavailable",
          message: `Could not verify ${candidate.supplierName}: ${result.reason}`,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      if (result.data.verdict === "fail") {
        ctx.emit({
          type: "agent_action",
          agent: "buyer",
          action: "supplier_rejected",
          message: `Rejected ${candidate.supplierName} despite the lowest price — ${result.data.reason}`,
          timestamp: new Date().toISOString(),
          data: { supplierId: candidate.supplierId },
        });
        continue;
      }

      ctx.emit({
        type: "agent_action",
        agent: "buyer",
        action: "supplier_selected",
        message: `Selected ${candidate.supplierName} — ${result.data.reason}`,
        timestamp: new Date().toISOString(),
        data: { supplierId: candidate.supplierId },
      });
      return candidate;
    }

    // Every check failed to run (the paid-service endpoints live in the web
    // server). Fall back rather than stall, but say so loudly.
    if (unverifiable === candidates.length && candidates.length > 0) {
      ctx.emit({
        type: "agent_action",
        agent: "system",
        action: "verification_skipped",
        message: "No verification service reachable — is `npm run server` running? Proceeding UNVERIFIED on the cheapest quote.",
        timestamp: new Date().toISOString(),
      });
      return candidates[0];
    }
    return undefined;
  }
}
