// src/x402/client.ts
//
// Agent half of x402: request, get 402, check the price against policy, pay,
// retry with proof. Every autonomous payment the agent makes goes through
// here, which is why the policy check lives here rather than in a prompt.

import { Client } from "xrpl";
import { AgentLogEvent } from "../shared/types";
import { PolicyEngine, Receipt } from "../shared/policy";
import { AGENT_SOURCE_TAG } from "../tools/xrplTools";
import { getOrCreateAgentWallet } from "./wallets";

const BASE_URL = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

/** Payment proofs keyed by call, so a failed retry never pays twice. */
const paidCalls = new Map<string, string>();

interface Quote {
  service: string;
  description: string;
  amount: number;
  payTo: string;
  nonce: string;
}

export interface PaidCallResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
}

export interface PaidCallContext {
  client: Client;
  policy: PolicyEngine;
  emit: (e: AgentLogEvent) => void;
  /** Called when a payment needs a human because it exceeds the auto-approval cap. */
  requestApproval?: (quote: Quote) => Promise<boolean>;
}

export async function callPaidService<T>(
  ctx: PaidCallContext,
  serviceId: string,
  path: string,
  impact: string,
): Promise<PaidCallResult<T>> {
  const url = `${BASE_URL()}${path}`;
  const callKey = `${serviceId}:${path}`;
  const existingProof = paidCalls.get(callKey);

  let response = await fetch(url, existingProof ? { headers: { "X-PAYMENT": existingProof } } : undefined);

  if (response.status !== 402) {
    if (!response.ok) return { ok: false, reason: `service returned ${response.status}` };
    return { ok: true, data: (await response.json()) as T };
  }

  const body = (await response.json()) as { accepts?: Quote[] };
  const quote = body.accepts?.[0];
  if (!quote) return { ok: false, reason: "merchant returned no payment terms" };

  const verdict = ctx.policy.check(serviceId, quote.amount);
  if (verdict.decision === "deny") {
    ctx.emit({
      type: "agent_action",
      agent: "system",
      action: "payment_blocked",
      message: `Spending policy blocked ${serviceId}: ${verdict.reason}`,
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: verdict.reason };
  }
  if (verdict.decision === "escalate") {
    ctx.emit({
      type: "agent_action",
      agent: "system",
      action: "payment_escalated",
      message: `Payment needs a human: ${verdict.reason}`,
      timestamp: new Date().toISOString(),
    });
    const approved = ctx.requestApproval ? await ctx.requestApproval(quote) : false;
    if (!approved) return { ok: false, reason: "payment was not approved" };
  }

  const txHash = await payQuote(ctx, quote);
  paidCalls.set(callKey, txHash);

  response = await fetch(url, { headers: { "X-PAYMENT": txHash } });
  if (!response.ok) return { ok: false, reason: `merchant rejected the proof (${response.status})` };

  const data = (await response.json()) as T;
  const receipt: Receipt = {
    service: serviceId,
    priceXrp: quote.amount,
    txHash,
    impact,
    timestamp: new Date().toISOString(),
  };
  ctx.policy.record(receipt);
  return { ok: true, data };
}

async function payQuote(ctx: PaidCallContext, quote: Quote): Promise<string> {
  const wallet = await getOrCreateAgentWallet(ctx.client);

  const response = await ctx.client.submitAndWait(
    {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: quote.payTo,
      Amount: String(Math.round(quote.amount * 1_000_000)),
      SourceTag: AGENT_SOURCE_TAG,
      Memos: [
        {
          Memo: {
            MemoData: Buffer.from(`x402:${quote.nonce}`, "utf8").toString("hex").toUpperCase(),
          },
        },
      ],
    } as any,
    { wallet },
  );

  const meta: any = response.result.meta;
  if (meta?.TransactionResult !== "tesSUCCESS") {
    throw new Error(`x402 payment failed: ${meta?.TransactionResult}`);
  }

  const txHash = response.result.hash;
  ctx.emit({
    type: "agent_action",
    agent: "buyer",
    action: "agent_paid",
    message: `Paid ${quote.amount} XRP for ${quote.description} — no human in the loop.`,
    timestamp: new Date().toISOString(),
    data: { service: quote.service, amountXrp: quote.amount, txHash },
  });
  return txHash;
}
