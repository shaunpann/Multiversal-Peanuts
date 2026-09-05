// src/x402/middleware.ts
//
// Merchant half of x402. A request with no proof of payment gets HTTP 402
// plus a nonce and the payment terms; the agent pays, quoting the nonce in a
// memo, then retries with the transaction hash in X-PAYMENT.
//
// Three things this checks that a naive implementation skips:
//   - the nonce is single-use and time-limited (replay protection)
//   - the payment was for THIS service, not a cheaper one
//   - what was DELIVERED, not what was submitted — transfer fees and partial
//     payments mean a merchant can receive less than the quote

import * as crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { Client, dropsToXrp } from "xrpl";
import { TESTNET_WSS } from "../tools/xrplTools";
import { getOrCreateMerchantWallet } from "./wallets";
import { PaidService } from "./services";

interface Challenge {
  nonce: string;
  serviceId: string;
  priceXrp: number;
  expiresAt: number;
  usedBy?: string;
}

const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 5 * 60_000;

/** One long-lived connection: this is a server, not a script. */
let shared: Client | undefined;
async function ledger(): Promise<Client> {
  if (!shared) shared = new Client(TESTNET_WSS);
  if (!shared.isConnected()) await shared.connect();
  return shared;
}

let merchantAddress: string | undefined;
export async function getMerchantAddress(): Promise<string> {
  if (!merchantAddress) {
    merchantAddress = (await getOrCreateMerchantWallet(await ledger())).address;
  }
  return merchantAddress;
}

export function requirePayment(service: PaidService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const proof = req.header("X-PAYMENT");

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
            payTo: await getMerchantAddress(),
            nonce: challenge.nonce,
            expiresAt: new Date(challenge.expiresAt).toISOString(),
          },
        ],
      });
      return;
    }

    try {
      const verified = await verifyPayment(proof, await getMerchantAddress());
      const challenge = challenges.get(verified.nonce);

      if (!challenge) return void res.status(402).json({ error: "unknown_or_expired_nonce" });
      if (challenge.expiresAt < Date.now()) return void res.status(402).json({ error: "challenge_expired" });
      if (challenge.serviceId !== service.id) {
        return void res.status(402).json({ error: "payment_was_for_a_different_service" });
      }
      // Single-use, except that the same payer may retry the same call with
      // the same proof — so a dropped response never costs a second payment.
      if (challenge.usedBy && challenge.usedBy !== proof) {
        return void res.status(402).json({ error: "nonce_already_used" });
      }
      if (verified.deliveredXrp + 1e-9 < challenge.priceXrp) {
        return void res
          .status(402)
          .json({ error: "underpaid", expected: challenge.priceXrp, delivered: verified.deliveredXrp });
      }

      challenge.usedBy = proof;
      next();
    } catch (err: any) {
      res.status(402).json({ error: "payment_verification_failed", detail: err.message });
    }
  };
}

async function verifyPayment(txHash: string, expectedDestination: string) {
  // Check the shape before asking the ledger: rippled's api_version 2 answers
  // a malformed `tx` lookup with "Not implemented." (notImpl), which surfaces
  // here as a confusing internal error rather than a bad-input one.
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) throw new Error("X-PAYMENT is not a transaction hash");

  const client = await ledger();
  const response = await client.request({ command: "tx", transaction: txHash });
  const result = response.result as any;
  const field = (name: string) => result[name] ?? result.tx_json?.[name];

  if (!result.validated) throw new Error("transaction is not validated yet");
  if (field("TransactionType") !== "Payment") throw new Error("not a Payment");
  if (field("Destination") !== expectedDestination) throw new Error("wrong destination");
  if (result.meta?.TransactionResult !== "tesSUCCESS") throw new Error("payment did not succeed");

  const delivered = result.meta?.delivered_amount;
  if (typeof delivered !== "string") throw new Error("non-XRP delivery is not accepted here");

  const memos: Array<{ Memo?: { MemoData?: string } }> = field("Memos") ?? [];
  const nonce = memos
    .map((m) => (m.Memo?.MemoData ? Buffer.from(m.Memo.MemoData, "hex").toString("utf8") : ""))
    .find((v) => v.startsWith("x402:"))
    ?.slice("x402:".length);
  if (!nonce) throw new Error("payment carries no x402 nonce memo");

  return { nonce, deliveredXrp: Number(dropsToXrp(delivered)) };
}
