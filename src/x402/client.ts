import crypto from "node:crypto";
import type { Receipt } from "../shared/types.js";
import { bus } from "../shared/events.js";
import { approvals } from "../shared/approvals.js";
import { policyEngine } from "../shared/policy.js";
import { AGENT_SOURCE_TAG, explorerUrl, getClient, getWallets, memo, resultCodeOf, toDrops, txHashOf } from "../xrpl/client.js";

const BASE_URL = () => `http://127.0.0.1:${process.env.PORT ?? 3000}`;

/** Payment proofs keyed by call, so a failed retry never pays twice. */
const paidCalls = new Map<string, string>();

interface Quote {
  service: string;
  amount: number;
  currency: string;
  payTo: string;
  nonce: string;
  description: string;
}

export interface PaidCallResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  receipt?: Receipt;
}

/**
 * Agent half of x402: request, get 402, check the payment against policy, pay,
 * retry with proof. The policy check sits here - below the model - so the agent
 * cannot reason its way past a spending limit.
 */
export async function callPaidService<T>(
  serviceId: string,
  path: string,
  impact: string,
): Promise<PaidCallResult<T>> {
  const url = `${BASE_URL()}${path}`;
  const callKey = `${serviceId}:${path}`;

  let response = await fetch(url, { headers: proofHeader(callKey) });

  if (response.status === 402) {
    const body = (await response.json()) as { accepts?: Quote[] };
    const quote = body.accepts?.[0];
    if (!quote) return { ok: false, reason: "merchant returned no payment terms" };

    const verdict = policyEngine.check(serviceId, quote.amount);
    if (verdict.decision === "deny") {
      bus.emitEvent("policy", "payment_blocked", `Blocked ${serviceId}: ${verdict.reason}`);
      return { ok: false, reason: verdict.reason };
    }
    if (verdict.decision === "escalate") {
      const approved = await approvals.request(
        "payment",
        `Pay ${quote.amount} XRP for ${quote.description}?`,
        { serviceId, amount: quote.amount, reason: verdict.reason },
      );
      if (!approved) return { ok: false, reason: "human declined the payment" };
    }

    const txHash = await payQuote(quote);
    paidCalls.set(callKey, txHash);

    response = await fetch(url, { headers: { "X-PAYMENT": txHash } });
    if (!response.ok) {
      return { ok: false, reason: `merchant rejected the payment proof (${response.status})` };
    }

    const data = (await response.json()) as T;
    const receipt: Receipt = {
      id: crypto.randomUUID(),
      service: serviceId,
      priceXrp: quote.amount,
      txHash,
      requestHash: sha256(path),
      responseHash: sha256(JSON.stringify(data)),
      impact,
      ts: new Date().toISOString(),
    };
    policyEngine.record(receipt);
    return { ok: true, data, receipt };
  }

  if (!response.ok) return { ok: false, reason: `service returned ${response.status}` };
  return { ok: true, data: (await response.json()) as T };
}

function proofHeader(callKey: string): Record<string, string> {
  const existing = paidCalls.get(callKey);
  return existing ? { "X-PAYMENT": existing } : {};
}

async function payQuote(quote: Quote): Promise<string> {
  const client = await getClient();
  const wallets = await getWallets();

  const response = await client.submitAndWait(
    {
      TransactionType: "Payment",
      Account: wallets.agent.address,
      Destination: quote.payTo,
      Amount: toDrops(quote.amount),
      SourceTag: AGENT_SOURCE_TAG,
      Memos: [memo("x402", `x402:${quote.nonce}`)],
    },
    { wallet: wallets.agent, autofill: true },
  );

  const code = resultCodeOf(response.result);
  if (code !== "tesSUCCESS") throw new Error(`x402 payment failed: ${code}`);

  const hash = txHashOf(response.result);
  bus.emitEvent(
    "buyer_agent",
    "agent_paid",
    `Paid ${quote.amount} XRP for ${quote.description} (no human in the loop)`,
    { txHash: hash, explorerUrl: explorerUrl(hash), data: { service: quote.service, amount: quote.amount } },
  );
  return hash;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function resetPaidCalls(): void {
  paidCalls.clear();
}
