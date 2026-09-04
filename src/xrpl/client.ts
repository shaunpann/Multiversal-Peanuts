import fs from "node:fs";
import { Client, Wallet, dropsToXrp, xrpToDrops } from "xrpl";
import { bus } from "../shared/events.js";

const ENDPOINT = process.env.XRPL_ENDPOINT ?? "wss://s.altnet.rippletest.net:51233";
const WALLET_FILE = ".wallets.json";

export type Role = "buyer" | "supplier" | "agent" | "merchant";

let client: Client | undefined;
let wallets: Record<Role, Wallet> | undefined;

export async function getClient(): Promise<Client> {
  if (!client) {
    client = new Client(ENDPOINT);
  }
  if (!client.isConnected()) {
    await client.connect();
  }
  return client;
}

export async function disconnect(): Promise<void> {
  if (client?.isConnected()) await client.disconnect();
}

export function explorerUrl(txHash: string): string {
  return `https://testnet.xrpl.org/transactions/${txHash}`;
}

export function accountUrl(address: string): string {
  return `https://testnet.xrpl.org/accounts/${address}`;
}

/**
 * Four accounts, because who holds the money is part of the design:
 *  - buyer    funds the escrows, signs only after a human approves the deal
 *  - agent    the agent's own allowance; it can never spend more than this
 *             balance, which is a spending control the ledger enforces
 *  - merchant receives x402 service payments
 *  - supplier receives escrow releases
 */
export async function getWallets(): Promise<Record<Role, Wallet>> {
  if (wallets) return wallets;

  const c = await getClient();
  const roles: Role[] = ["buyer", "supplier", "agent", "merchant"];

  let seeds: Partial<Record<Role, string>> = {};
  if (fs.existsSync(WALLET_FILE)) {
    seeds = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")) as Partial<Record<Role, string>>;
  }

  const result = {} as Record<Role, Wallet>;
  for (const role of roles) {
    const seed = seeds[role];
    if (seed) {
      const w = Wallet.fromSeed(seed);
      if (await isFunded(w.address)) {
        result[role] = w;
        continue;
      }
    }
    bus.emitEvent("system", "funding_wallet", `Funding ${role} wallet from the testnet faucet...`);
    const funded = await c.fundWallet(seed ? Wallet.fromSeed(seed) : null, { amount: "20" });
    result[role] = funded.wallet;
  }

  fs.writeFileSync(
    WALLET_FILE,
    JSON.stringify(Object.fromEntries(roles.map((r) => [r, result[r].seed])), null, 2),
  );
  wallets = result;

  for (const role of roles) {
    const balance = await getBalanceXrp(result[role].address);
    bus.emitEvent("system", "wallet_ready", `${role}: ${result[role].address} (${balance} XRP)`, {
      data: { role, address: result[role].address, balanceXrp: balance },
    });
  }
  return wallets;
}

async function isFunded(address: string): Promise<boolean> {
  try {
    await getBalanceXrp(address);
    return true;
  } catch {
    return false;
  }
}

export async function getBalanceXrp(address: string): Promise<number> {
  const c = await getClient();
  const res = await c.request({ command: "account_info", account: address, ledger_index: "validated" });
  return Number(dropsToXrp(res.result.account_data.Balance));
}

export function toDrops(xrp: number): string {
  return xrpToDrops(xrp.toFixed(6));
}

/** submitAndWait result shapes differ between API v1 and v2 - read both. */
export function txHashOf(result: unknown): string {
  const r = result as { hash?: string; tx_json?: { hash?: string } };
  return r.hash ?? r.tx_json?.hash ?? "";
}

export function txFieldOf<T>(result: unknown, field: string): T | undefined {
  const r = result as Record<string, unknown> & { tx_json?: Record<string, unknown> };
  return (r[field] ?? r.tx_json?.[field]) as T | undefined;
}

export function resultCodeOf(result: unknown): string {
  const meta = (result as { meta?: unknown }).meta;
  if (typeof meta === "object" && meta !== null && "TransactionResult" in meta) {
    return String((meta as { TransactionResult: string }).TransactionResult);
  }
  return "unknown";
}

/** Every agent-submitted transaction carries this tag, so agent activity is
 *  filterable on-ledger. See xrpl.org/docs/agents/track-agent-behavior */
export const AGENT_SOURCE_TAG = 402402;

export function memo(type: string, data: string): { Memo: { MemoType: string; MemoData: string } } {
  return {
    Memo: {
      MemoType: Buffer.from(type, "utf8").toString("hex").toUpperCase(),
      MemoData: Buffer.from(data, "utf8").toString("hex").toUpperCase(),
    },
  };
}
