// src/x402/wallets.ts
//
// Two long-lived accounts the x402 plane needs, kept separate from the
// buyer's money on purpose:
//
//   agent    — the buyer agent's own allowance. It signs service payments
//              with no human in the loop, so its maximum possible loss is
//              its balance. Authority denominated in a funded account, not
//              a config value.
//   merchant — receives payment for the paid services.
//
// Both are created and funded from the testnet faucet on first use and
// persisted through the same store as the buyer/verifier wallets.

import { Client, Wallet } from "xrpl";
import { getWallet, saveWallet } from "../server/store";
import { createFundedWallet } from "../tools/xrplTools";

const SHARED = "shared";

async function getOrCreate(client: Client, role: "agent" | "merchant"): Promise<Wallet> {
  const existing = getWallet(role, SHARED);
  if (existing) return Wallet.fromSeed(existing.seed);

  const { wallet } = await createFundedWallet(client, `${role} (shared)`);
  saveWallet({ role, ownerId: SHARED, address: wallet.address, seed: wallet.seed! });
  return wallet;
}

export const getOrCreateAgentWallet = (client: Client) => getOrCreate(client, "agent");
export const getOrCreateMerchantWallet = (client: Client) => getOrCreate(client, "merchant");
