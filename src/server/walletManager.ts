// src/server/walletManager.ts
//
// Custodial demo wallet management for the web app. A real product would use
// wallet-connect (Xaman/Crossmark) so the buyer signs with their own key —
// see docs/resources.md. For this prototype, the app creates and funds a
// testnet wallet per buyer on first use and signs on their behalf, matching
// the XRPL Agent Wallet skill's "env-var pattern (development, single-agent,
// low value)" — appropriate here because these are unfunded testnet wallets,
// not real money.
//
// The seed never leaves this module: it's read from the store, used to
// construct a Wallet in-process, and goes out of scope. It is never logged,
// never included in any HTTP response, and the store file itself is
// gitignored (see .gitignore).

import { Client, Wallet } from "xrpl";
import { getWallet, saveWallet } from "./store";
import { createFundedWallet } from "../tools/xrplTools";

const SHARED_VERIFIER_OWNER_ID = "shared";

export async function getOrCreateBuyerWallet(client: Client, buyerContact: string): Promise<Wallet> {
  const existing = getWallet("buyer", buyerContact);
  if (existing) return Wallet.fromSeed(existing.seed);

  const { wallet } = await createFundedWallet(client, `buyer:${buyerContact}`);
  saveWallet({ role: "buyer", ownerId: buyerContact, address: wallet.address, seed: wallet.seed! });
  return wallet;
}

/** One shared verification-agent wallet submits every EscrowFinish/EscrowCancel across deals. */
export async function getOrCreateVerifierWallet(client: Client): Promise<Wallet> {
  const existing = getWallet("verifier", SHARED_VERIFIER_OWNER_ID);
  if (existing) return Wallet.fromSeed(existing.seed);

  const { wallet } = await createFundedWallet(client, "verification-agent (shared)");
  saveWallet({ role: "verifier", ownerId: SHARED_VERIFIER_OWNER_ID, address: wallet.address, seed: wallet.seed! });
  return wallet;
}
