import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { dropsToXrp } from "xrpl";
import { getClient, getWallets } from "../xrpl/client.js";
import type { PaidService } from "./services.js";

interface Challenge {
  nonce: string;
  serviceId: string;
  priceXrp: number;
  expiresAt: number;
  usedBy?: string;
}

const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Merchant half of x402. A request without proof of payment gets a 402 with
 * a nonce; the agent pays, quoting the nonce in a memo, then retries with the
 * transaction hash in X-PAYMENT.
 */
export function requirePayment(service: PaidService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const proof = req.header("X-PAYMENT");
    const wallets = await getWallets();

    if (!proof) {
      const challenge: Challenge = {
        nonce: crypto.randomBytes(12).toString("hex"),
        serviceId: service.id,
        priceXrp: service.priceXrp,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      };
      challenges.set(challenge.nonce, challenge);
      res.status(402).json({
        error: "payment_required",
        accepts: [
          {
            scheme: "xrpl",
            network: "testnet",
            service: service.id,
            description: service.description,
            amount: service.priceXrp,
            currency: "XRP",
            payTo: wallets.merchant.address,
            nonce: challenge.nonce,
            expiresAt: new Date(challenge.expiresAt).toISOString(),
          },
        ],
      });
      return;
    }

    try {
      const verdict = await verifyPayment(proof, wallets.merchant.address);
      const challenge = challenges.get(verdict.nonce);
      if (!challenge) {
        res.status(402).json({ error: "unknown_or_expired_nonce" });
        return;
      }
      if (challenge.expiresAt < Date.now()) {
        res.status(402).json({ error: "challenge_expired" });
        return;
      }
      // Replay protection: a nonce is spendable once, but the same payer may
      // retry the same call with the same proof (idempotent retry).
      if (challenge.usedBy && challenge.usedBy !== proof) {
        res.status(402).json({ error: "nonce_already_used" });
        return;
      }
      if (challenge.serviceId !== service.id) {
        res.status(402).json({ error: "payment_was_for_a_different_service" });
        return;
      }
      // Verify what was DELIVERED, not what was submitted: transfer fees and
      // partial payments mean the merchant can receive less than the quote.
      if (verdict.deliveredXrp + 1e-9 < challenge.priceXrp) {
        res.status(402).json({
          error: "underpaid",
          expected: challenge.priceXrp,
          delivered: verdict.deliveredXrp,
        });
        return;
      }

      challenge.usedBy = proof;
      next();
    } catch (err) {
      res.status(402).json({ error: "payment_verification_failed", detail: String(err) });
    }
  };
}

interface Verified {
  nonce: string;
  deliveredXrp: number;
}

async function verifyPayment(txHash: string, expectedDestination: string): Promise<Verified> {
  // Validate the shape before asking the ledger: rippled's api_version 2
  // answers a malformed `tx` lookup with "Not implemented." (notImpl), which
  // would surface here as a confusing internal error.
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) throw new Error("X-PAYMENT is not a transaction hash");

  const client = await getClient();
  const response = await client.request({ command: "tx", transaction: txHash });
  const result = response.result as unknown as Record<string, unknown> & {
    tx_json?: Record<string, unknown>;
    meta?: unknown;
    validated?: boolean;
  };
  const field = <T>(name: string): T | undefined =>
    (result[name] ?? result.tx_json?.[name]) as T | undefined;

  if (!result.validated) throw new Error("transaction is not validated yet");
  if (field<string>("TransactionType") !== "Payment") throw new Error("not a Payment");
  if (field<string>("Destination") !== expectedDestination) throw new Error("wrong destination");

  const meta = result.meta as { TransactionResult?: string; delivered_amount?: unknown };
  if (meta?.TransactionResult !== "tesSUCCESS") throw new Error("payment did not succeed");

  const delivered = meta.delivered_amount;
  if (typeof delivered !== "string") throw new Error("non-XRP delivery is not accepted here");

  const memos = field<Array<{ Memo?: { MemoData?: string } }>>("Memos") ?? [];
  const nonce = memos
    .map((m) => (m.Memo?.MemoData ? Buffer.from(m.Memo.MemoData, "hex").toString("utf8") : ""))
    .find((value) => value.startsWith("x402:"))
    ?.slice("x402:".length);
  if (!nonce) throw new Error("payment carries no x402 nonce memo");

  return { nonce, deliveredXrp: Number(dropsToXrp(delivered)) };
}
