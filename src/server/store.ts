// src/server/store.ts
//
// Minimal local persistence for the demo app: deal records and per-buyer
// custodial wallet seeds. A JSON file, not a database — fine for a hackathon
// prototype, single process, low concurrency. Everything here lives under
// data/, which is gitignored (see .gitignore) — never commit it.
//
// Wallet seeds stored here follow the same non-negotiable as everywhere else:
// never logged, never sent to the client, read only at the point of signing.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");
const WALLETS_FILE = path.join(DATA_DIR, "wallets.json");

export type DealStatus =
  | "AWAITING_SUPPLIER" // buyer created it, waiting on supplier's XRPL address
  | "LOCKED" // escrow created, waiting on delivery evidence
  | "UNDER_REVIEW" // evidence submitted, verification agent deciding
  | "NEEDS_MANUAL_REVIEW" // agent couldn't judge this itself (e.g. a photo with no vision model available) — waiting on the buyer
  | "RELEASED" // EscrowFinish succeeded
  | "REFUND_PENDING" // failed verification, waiting on CancelAfter
  | "REFUNDED"; // EscrowCancel succeeded

export interface DealRecord {
  id: string;
  inviteToken: string;
  buyerContact: string;
  supplierContact: string;
  productName: string;
  amountUSD: number;
  deadlineDays: number;
  status: DealStatus;

  buyerAddress?: string;
  supplierAddress?: string;
  escrowCondition?: string;
  escrowFulfillment?: string; // held server-side only; never returned to any client
  escrowSequence?: number;
  cancelAfterUnixSeconds?: number;

  escrowCreateTxHash?: string;
  escrowFinishTxHash?: string;
  escrowCancelTxHash?: string;

  evidence?: {
    trackingNumber: string;
    note: string;
    imagePath?: string;
  };
  verification?: {
    passed: boolean | null; // null = awaiting a human decision (see NEEDS_MANUAL_REVIEW)
    reasoning: string;
    method: "ai" | "fallback" | "manual";
  };

  createdAt: string;
  updatedAt: string;
}

export interface WalletRecord {
  role: "buyer" | "verifier" | "agent" | "merchant";
  ownerId: string; // buyerContact for role=buyer; "shared" for the single verifier/agent/merchant wallets
  address: string;
  seed: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ---------------- Deals ----------------

export function listDeals(): DealRecord[] {
  return readJson<DealRecord[]>(DEALS_FILE, []);
}

export function getDeal(id: string): DealRecord | undefined {
  return listDeals().find((d) => d.id === id);
}

export function getDealByToken(token: string): DealRecord | undefined {
  return listDeals().find((d) => d.inviteToken === token);
}

export function createDeal(input: {
  buyerContact: string;
  supplierContact: string;
  productName: string;
  amountUSD: number;
  deadlineDays: number;
}): DealRecord {
  const now = new Date().toISOString();
  const deal: DealRecord = {
    id: `DEAL-${crypto.randomBytes(4).toString("hex")}`,
    inviteToken: crypto.randomBytes(12).toString("hex"),
    status: "AWAITING_SUPPLIER",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  const deals = listDeals();
  deals.push(deal);
  writeJson(DEALS_FILE, deals);
  return deal;
}

export function updateDeal(id: string, patch: Partial<DealRecord>): DealRecord {
  const deals = listDeals();
  const idx = deals.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Deal ${id} not found`);
  deals[idx] = { ...deals[idx], ...patch, updatedAt: new Date().toISOString() };
  writeJson(DEALS_FILE, deals);
  return deals[idx];
}

/** Strips server-only secrets before a deal record goes to any HTTP response. */
export function toPublicDeal(deal: DealRecord) {
  const { escrowFulfillment, ...publicFields } = deal;
  return publicFields;
}

// ---------------- Wallets ----------------

function listWallets(): WalletRecord[] {
  return readJson<WalletRecord[]>(WALLETS_FILE, []);
}

export function getWallet(role: WalletRecord["role"], ownerId: string): WalletRecord | undefined {
  return listWallets().find((w) => w.role === role && w.ownerId === ownerId);
}

export function saveWallet(record: WalletRecord) {
  const wallets = listWallets();
  const idx = wallets.findIndex((w) => w.role === record.role && w.ownerId === record.ownerId);
  if (idx === -1) wallets.push(record);
  else wallets[idx] = record;
  writeJson(WALLETS_FILE, wallets);
}
