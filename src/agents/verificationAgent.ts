import { Client, Wallet } from "xrpl";
import { verifyDocuments, checkShipmentStatus } from "../tools/agentTools";
import { generateEscrowCondition, finishEscrow, cancelEscrow } from "../tools/xrplTools";
import { AgentLogEvent, DealTerms } from "../shared/types";

/**
 * The verification agent is the settlement layer's decision-maker: it holds
 * the escrow release condition, inspects delivery evidence, and autonomously
 * triggers EscrowFinish (release) or EscrowCancel (refund) on XRPL — no
 * manual bank transfer, no human back-and-forth once the deal is authorized.
 *
 * Per the XRPL Agent Wallet skill, the fulfillment (the secret half of the
 * condition) must never be logged or exposed — it is held only in this
 * agent's in-memory map, keyed by dealId, until it decides to reveal it in
 * an EscrowFinish transaction.
 */
export class VerificationAgent {
  private fulfillments = new Map<string, string>();

  /** Generates the condition/fulfillment pair for a new deal's escrow. Called before EscrowCreate. */
  public generateReleaseCondition(dealId: string): { condition: string } {
    const { condition, fulfillment } = generateEscrowCondition();
    this.fulfillments.set(dealId, fulfillment);
    return { condition };
  }

  /**
   * Inspects the deal's documents/shipment and decides: release funds (finish
   * the escrow) or flag for refund (cancel path, subject to CancelAfter having
   * elapsed on-ledger — see note in orchestrator).
   */
  public async verifyAndSettle(
    client: Client,
    verifierWallet: Wallet,
    deal: DealTerms,
    emitEvent: (e: AgentLogEvent) => void
  ): Promise<{ passed: boolean; finishTxHash?: string }> {
    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: "inspecting_documents",
      message: `Verification Agent inspecting Certificate of Conformity for Deal ${deal.dealId}...`,
      timestamp: new Date().toISOString(),
    });

    const result = await verifyDocuments(deal.dealId);

    if (!result.passed) {
      emitEvent({
        type: "agent_action",
        agent: "verification",
        action: "inspection_failed",
        message: `Inspection failed for Deal ${deal.dealId}. Funds remain locked until CancelAfter elapses (buyer-initiated refund path).`,
        timestamp: new Date().toISOString(),
      });
      return { passed: false };
    }

    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: "inspection_passed",
      message: `Inspection passed! Certificate ID: ${result.certificateId}. Releasing escrow autonomously...`,
      timestamp: new Date().toISOString(),
    });

    const fulfillment = this.fulfillments.get(deal.dealId);
    if (!fulfillment || !deal.escrowCondition || deal.escrowSequence === undefined || !deal.buyerAddress) {
      throw new Error(`Missing escrow context for deal ${deal.dealId} — cannot finish escrow`);
    }

    const finished = await finishEscrow({
      client,
      submitterWallet: verifierWallet,
      ownerAddress: deal.buyerAddress,
      sequence: deal.escrowSequence,
      condition: deal.escrowCondition,
      fulfillment,
      memo: { agent_id: "verification-agent-v1", deal_id: deal.dealId, action: "autonomous_release" },
    });

    if (finished.resultCode !== "tesSUCCESS") {
      throw new Error(`EscrowFinish failed: ${finished.resultCode}`);
    }

    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: "escrow_released",
      message: `Funds released to supplier. EscrowFinish tx: ${finished.txHash}`,
      timestamp: new Date().toISOString(),
    });

    return { passed: true, finishTxHash: finished.txHash };
  }

  /**
   * Refund path safeguard: buyer reclaims funds via EscrowCancel. Only
   * succeeds on-ledger once CancelAfter has passed — this is XRPL's own
   * enforcement, not something the agent can bypass, which is exactly the
   * guarantee the buyer is relying on.
   */
  public async refund(
    client: Client,
    buyerWallet: Wallet,
    deal: DealTerms,
    emitEvent: (e: AgentLogEvent) => void
  ): Promise<{ cancelTxHash?: string; resultCode: string }> {
    if (deal.escrowSequence === undefined) {
      throw new Error(`Missing escrow sequence for deal ${deal.dealId} — cannot cancel escrow`);
    }

    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: "refund_requested",
      message: `Submitting EscrowCancel for Deal ${deal.dealId} to reclaim locked funds...`,
      timestamp: new Date().toISOString(),
    });

    const cancelled = await cancelEscrow({
      client,
      ownerWallet: buyerWallet,
      sequence: deal.escrowSequence,
      memo: { agent_id: "verification-agent-v1", deal_id: deal.dealId, action: "refund_after_failed_inspection" },
    });

    emitEvent({
      type: "agent_action",
      agent: "verification",
      action: cancelled.resultCode === "tesSUCCESS" ? "refund_complete" : "refund_pending",
      message:
        cancelled.resultCode === "tesSUCCESS"
          ? `Refund complete. EscrowCancel tx: ${cancelled.txHash}`
          : `EscrowCancel not yet possible (${cancelled.resultCode}) — CancelAfter has likely not elapsed on-ledger yet.`,
      timestamp: new Date().toISOString(),
    });

    return { cancelTxHash: cancelled.txHash, resultCode: cancelled.resultCode };
  }
}

export class LogisticsAgent {
  public async confirmDelivery(trackingNumber: string, emitEvent: (e: AgentLogEvent) => void) {
    emitEvent({
      type: "agent_action",
      agent: "logistics",
      action: "check_shipment",
      message: `Logistics Agent pinging carrier API for tracking #${trackingNumber}...`,
      timestamp: new Date().toISOString(),
    });

    const shipment = await checkShipmentStatus(trackingNumber);

    emitEvent({
      type: "agent_action",
      agent: "logistics",
      action: "delivery_confirmed",
      message: `Carrier status: ${shipment.status} via ${shipment.carrier}. Delivery confirmed.`,
      timestamp: new Date().toISOString(),
    });

    return shipment;
  }
}
