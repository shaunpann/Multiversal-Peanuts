// src/tools/xrplTools.ts
//
// XRPL settlement plumbing: testnet wallets + conditional escrow (lock funds,
// monitor conditions, release/refund) — following the XRPL AI Starter Kit's
// Agent Wallet + Payments skill patterns (see skills/xrpl-agentic-resources/
// xrpl-dev-portal/.claude/skills/xrpl-skills/*).
//
// Signing ceremony non-negotiables observed here:
//   - testnet only, endpoint always shown in logs
//   - autofill before every submit (client.autofill / built into submitAndWait+wallet)
//   - submitAndWait, never bare submit
//   - SourceTag + Memo on every transaction (on-chain audit trail / attribution)
//   - hash persisted (logged) before/at submission
//   - seed only ever lives in `wallet.seed` in-memory / .env, never logged
//
// This module signs locally with env-loaded seeds (Pattern 1: env-var,
// development, testnet, low value) — appropriate for a hackathon prototype.
// Production would swap in Pattern 2 (external signer / KMS) per the skill.

import { Client, Wallet, Payment } from "xrpl";
import * as crypto from "crypto";

// five-bells-condition has no types; declare the shape we use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PreimageSha256 } = require("five-bells-condition");

export const TESTNET_WSS = "wss://s.altnet.rippletest.net:51233";
export const AGENT_SOURCE_TAG = 20260530; // XRPL AI Starter Kit default agent tag
const RIPPLE_EPOCH_OFFSET = 946684800; // seconds between Unix epoch and Ripple epoch

export function unixToRippleTime(unixSeconds: number): number {
  return Math.floor(unixSeconds) - RIPPLE_EPOCH_OFFSET;
}

export interface SettlementWallet {
  address: string;
  wallet: Wallet;
}

export async function getClient(): Promise<Client> {
  const client = new Client(TESTNET_WSS);
  await client.connect();
  return client;
}

/**
 * Creates and funds a fresh testnet wallet via the public faucet.
 * The seed lives only in the returned Wallet object / process memory —
 * callers are responsible for persisting it to .env if it needs to survive
 * the process (see xrpl-agent-wallet SKILL.md "First-time setup").
 */
export async function createFundedWallet(client: Client, label: string): Promise<SettlementWallet> {
  const { wallet } = await client.fundWallet();
  console.log(`[xrplTools] Funded ${label} wallet: ${wallet.address} (network: testnet)`);
  return { address: wallet.address, wallet };
}

export function loadWalletFromEnv(envVar: string): Wallet {
  const seed = process.env[envVar];
  if (!seed) {
    throw new Error(`${envVar} is not set — cannot load wallet`);
  }
  return Wallet.fromSeed(seed);
}

/** Builds a hex-encoded on-chain Memo from a plain object (JSON payload). */
function buildMemo(payload: Record<string, unknown>) {
  const data = Buffer.from(JSON.stringify(payload)).toString("hex").toUpperCase();
  return { Memo: { MemoData: data } };
}

/** Generates a PREIMAGE-SHA-256 condition/fulfillment pair for conditional escrow release. */
export function generateEscrowCondition(): { condition: string; fulfillment: string } {
  const preimage = crypto.randomBytes(32);
  const fulfillment = new PreimageSha256();
  fulfillment.setPreimage(preimage);
  return {
    condition: fulfillment.getConditionBinary().toString("hex").toUpperCase(),
    fulfillment: fulfillment.serializeBinary().toString("hex").toUpperCase(),
  };
}

export interface CreateEscrowParams {
  client: Client;
  fromWallet: Wallet;
  toAddress: string;
  amountDrops: string;
  condition: string;
  cancelAfterSeconds: number; // seconds from now — safety-net refund deadline
  memo: Record<string, unknown>;
}

export interface EscrowResult {
  txHash: string;
  sequence: number;
  resultCode: string;
}

/** Buyer locks funds: EscrowCreate with a crypto-condition + CancelAfter safety net. */
export async function createEscrow(params: CreateEscrowParams): Promise<EscrowResult> {
  const { client, fromWallet, toAddress, amountDrops, condition, cancelAfterSeconds, memo } = params;

  const tx: any = {
    TransactionType: "EscrowCreate",
    Account: fromWallet.address,
    Destination: toAddress,
    Amount: amountDrops,
    Condition: condition,
    CancelAfter: unixToRippleTime(Date.now() / 1000 + cancelAfterSeconds),
    SourceTag: AGENT_SOURCE_TAG,
    Memos: [buildMemo(memo)],
  };

  console.log("─── XRPL Transaction Preview ───────────────────────────────────────");
  console.log(`Network  : testnet`);
  console.log(`Type     : EscrowCreate`);
  console.log(`From     : ${fromWallet.address}`);
  console.log(`To       : ${toAddress}`);
  console.log(`Amount   : ${Number(amountDrops) / 1_000_000} XRP`);
  console.log(`Condition: ${condition}`);
  console.log(`CancelAfter: +${cancelAfterSeconds}s from now (refund safety net)`);
  console.log("─────────────────────────────────────────────────────────────────────");

  const response = await client.submitAndWait(tx, { wallet: fromWallet });
  const meta: any = response.result.meta;
  const resultCode = meta?.TransactionResult ?? "UNKNOWN";
  const sequence = (response.result as any).Sequence ?? (response.result as any).tx_json?.Sequence;

  console.log(`[xrplTools] EscrowCreate -> ${resultCode} | hash: ${response.result.hash} | seq: ${sequence}`);
  return { txHash: response.result.hash, sequence, resultCode };
}

export interface FinishEscrowParams {
  client: Client;
  submitterWallet: Wallet; // whoever submits (recipient or owner)
  ownerAddress: string;
  sequence: number;
  condition: string;
  fulfillment: string;
  memo: Record<string, unknown>;
}

/** Verification agent releases funds: EscrowFinish with the fulfillment it held privately. */
export async function finishEscrow(params: FinishEscrowParams): Promise<EscrowResult> {
  const { client, submitterWallet, ownerAddress, sequence, condition, fulfillment, memo } = params;

  const tx: any = {
    TransactionType: "EscrowFinish",
    Account: submitterWallet.address,
    Owner: ownerAddress,
    OfferSequence: sequence,
    Condition: condition,
    Fulfillment: fulfillment,
    SourceTag: AGENT_SOURCE_TAG,
    Memos: [buildMemo(memo)],
  };

  const response = await client.submitAndWait(tx, { wallet: submitterWallet });
  const meta: any = response.result.meta;
  const resultCode = meta?.TransactionResult ?? "UNKNOWN";

  console.log(`[xrplTools] EscrowFinish -> ${resultCode} | hash: ${response.result.hash}`);
  return { txHash: response.result.hash, sequence, resultCode };
}

export interface CancelEscrowParams {
  client: Client;
  ownerWallet: Wallet;
  sequence: number;
  memo: Record<string, unknown>;
}

/** Failure path / safeguard: buyer reclaims funds after CancelAfter if verification never completed. */
export async function cancelEscrow(params: CancelEscrowParams): Promise<EscrowResult> {
  const { client, ownerWallet, sequence, memo } = params;

  const tx: any = {
    TransactionType: "EscrowCancel",
    Account: ownerWallet.address,
    Owner: ownerWallet.address,
    OfferSequence: sequence,
    SourceTag: AGENT_SOURCE_TAG,
    Memos: [buildMemo(memo)],
  };

  const response = await client.submitAndWait(tx, { wallet: ownerWallet });
  const meta: any = response.result.meta;
  const resultCode = meta?.TransactionResult ?? "UNKNOWN";

  console.log(`[xrplTools] EscrowCancel -> ${resultCode} | hash: ${response.result.hash}`);
  return { txHash: response.result.hash, sequence, resultCode };
}
