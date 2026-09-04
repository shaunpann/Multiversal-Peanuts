import crypto from "node:crypto";
import { isoTimeToRippleTime } from "xrpl";
import type { Deal, EscrowRecord } from "../shared/types.js";
import { bus } from "../shared/events.js";
import {
  AGENT_SOURCE_TAG,
  explorerUrl,
  getClient,
  getWallets,
  memo,
  resultCodeOf,
  toDrops,
  txFieldOf,
  txHashOf,
} from "./client.js";
import { escrowFinishFeeDrops, generateCondition, vault } from "./conditions.js";

const escrows = new Map<string, EscrowRecord[]>();

export function escrowsFor(dealId: string): EscrowRecord[] {
  return escrows.get(dealId) ?? [];
}

export function allEscrows(): EscrowRecord[] {
  return [...escrows.values()].flat();
}

/**
 * One XRPL escrow releases once, all-or-nothing - EscrowFinish cannot pay out
 * part of the amount. So a 30/30/40 milestone structure is three escrows,
 * created up front, each with its own condition and its own CancelAfter.
 */
export async function createMilestoneEscrows(deal: Deal): Promise<EscrowRecord[]> {
  const c = await getClient();
  const w = await getWallets();
  const termsHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ id: deal.dealId, m: deal.milestones, total: deal.amountXrp }))
    .digest("hex");

  const created: EscrowRecord[] = [];

  for (const milestone of deal.milestones) {
    const amountXrp = Number(((deal.amountXrp * milestone.pct) / 100).toFixed(6));
    const pair = generateCondition();
    vault.put(deal.dealId, milestone.id, pair);

    const cancelAfter = new Date(Date.now() + milestone.deadlineDays * 86_400_000);

    const response = await c.submitAndWait(
      {
        TransactionType: "EscrowCreate",
        Account: w.buyer.address,
        Destination: w.supplier.address,
        Amount: toDrops(amountXrp),
        Condition: pair.condition,
        CancelAfter: isoTimeToRippleTime(cancelAfter.toISOString()),
        SourceTag: AGENT_SOURCE_TAG,
        Memos: [
          memo("deal", deal.dealId),
          memo("milestone", milestone.id),
          memo("terms-sha256", termsHash),
        ],
      },
      { wallet: w.buyer, autofill: true },
    );

    const code = resultCodeOf(response.result);
    if (code !== "tesSUCCESS") {
      throw new Error(`EscrowCreate for ${milestone.id} failed: ${code}`);
    }

    const record: EscrowRecord = {
      dealId: deal.dealId,
      milestoneId: milestone.id,
      label: milestone.label,
      pct: milestone.pct,
      amountXrp,
      owner: w.buyer.address,
      destination: w.supplier.address,
      sequence: txFieldOf<number>(response.result, "Sequence") ?? 0,
      condition: pair.condition,
      cancelAfterIso: cancelAfter.toISOString(),
      createTxHash: txHashOf(response.result),
      status: "locked",
    };
    created.push(record);

    bus.emitEvent(
      "settlement",
      "escrow_created",
      `Locked ${amountXrp} XRP for '${milestone.label}' (${milestone.pct}%)`,
      { txHash: record.createTxHash, explorerUrl: explorerUrl(record.createTxHash), data: { ...record } },
    );
  }

  escrows.set(deal.dealId, created);
  return created;
}

/**
 * Reveal the preimage for one milestone. Anyone may submit EscrowFinish, so
 * this does not need the buyer's key - only the preimage the vault holds.
 */
export async function releaseMilestone(
  dealId: string,
  milestoneId: string,
): Promise<EscrowRecord> {
  const record = escrowsFor(dealId).find((e) => e.milestoneId === milestoneId);
  if (!record) throw new Error(`no escrow for ${dealId}/${milestoneId}`);
  if (record.status !== "locked") throw new Error(`escrow ${milestoneId} is already ${record.status}`);

  const pair = vault.get(dealId, milestoneId);
  if (!pair) throw new Error(`no preimage held for ${dealId}/${milestoneId}`);

  const c = await getClient();
  const w = await getWallets();

  const response = await c.submitAndWait(
    {
      TransactionType: "EscrowFinish",
      Account: w.agent.address,
      Owner: record.owner,
      OfferSequence: record.sequence,
      Condition: record.condition,
      Fulfillment: pair.fulfillment,
      Fee: escrowFinishFeeDrops(pair.fulfillment),
      SourceTag: AGENT_SOURCE_TAG,
      Memos: [memo("deal", dealId), memo("milestone", milestoneId)],
    },
    { wallet: w.agent, autofill: true },
  );

  const code = resultCodeOf(response.result);
  if (code !== "tesSUCCESS") throw new Error(`EscrowFinish for ${milestoneId} failed: ${code}`);

  record.status = "released";
  record.finishTxHash = txHashOf(response.result);

  bus.emitEvent(
    "settlement",
    "funds_released",
    `Released ${record.amountXrp} XRP to the supplier for '${record.label}'`,
    { txHash: record.finishTxHash, explorerUrl: explorerUrl(record.finishTxHash), data: { ...record } },
  );
  return record;
}

/**
 * The failure path the challenge brief asks about: if nobody ever releases,
 * the buyer reclaims the funds after CancelAfter without needing the
 * supplier's or the oracle's cooperation.
 */
export async function cancelMilestone(dealId: string, milestoneId: string): Promise<EscrowRecord> {
  const record = escrowsFor(dealId).find((e) => e.milestoneId === milestoneId);
  if (!record) throw new Error(`no escrow for ${dealId}/${milestoneId}`);
  if (new Date(record.cancelAfterIso) > new Date()) {
    throw new Error(`escrow is refundable only after ${record.cancelAfterIso}`);
  }

  const c = await getClient();
  const w = await getWallets();
  const response = await c.submitAndWait(
    {
      TransactionType: "EscrowCancel",
      Account: w.buyer.address,
      Owner: record.owner,
      OfferSequence: record.sequence,
    },
    { wallet: w.buyer, autofill: true },
  );

  const code = resultCodeOf(response.result);
  if (code !== "tesSUCCESS") throw new Error(`EscrowCancel failed: ${code}`);

  record.status = "cancelled";
  bus.emitEvent("settlement", "escrow_cancelled", `Refunded ${record.amountXrp} XRP to the buyer`, {
    txHash: txHashOf(response.result),
    explorerUrl: explorerUrl(txHashOf(response.result)),
  });
  return record;
}

export function resetEscrows(): void {
  escrows.clear();
  vault.reset();
}
