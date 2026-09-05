// src/server/index.ts
//
// Tideline web app: the real buyer/supplier-facing settlement flow.
//   Buyer creates a deal -> sends the supplier a link (WhatsApp/email/etc,
//   outside this app) -> supplier submits their XRPL address (locks funds)
//   -> supplier submits delivery evidence -> verification agent reviews it
//   and autonomously releases or holds the escrow for refund.
//
// Run with: npm run server   (needs `npm install` first; see README)

import "dotenv/config";
import express from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";

import { getClient, createEscrow, finishEscrow, cancelEscrow, generateEscrowCondition, unixToRippleTime } from "../tools/xrplTools";
import { getOrCreateBuyerWallet, getOrCreateVerifierWallet } from "./walletManager";
import { createDeal, DealRecord, getDeal, getDealByToken, listDeals, toPublicDeal, updateDeal } from "./store";
import { reviewEvidence } from "./evidenceReviewer";
import { SERVICES } from "../x402/services";
import { requirePayment, getMerchantAddress } from "../x402/middleware";
import { TradeOrchestrator } from "../agents/orchestrator";
import { AgentLogEvent, BuyerIntent } from "../shared/types";
import { Client, Wallet, isValidAddress } from "xrpl";

const PORT = Number(process.env.PORT || 3001);
const CANCEL_AFTER_SECONDS = Number(process.env.CANCEL_AFTER_SECONDS || 7 * 24 * 60 * 60); // 7 days default
const DEMO_USD_TO_XRP_RATE = 0.01; // see orchestrator.ts note — placeholder, not a real FX rate

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 8 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..", "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

function usdToDemoDrops(amountUsd: number): string {
  const xrp = Math.max(1, amountUsd * DEMO_USD_TO_XRP_RATE);
  return String(Math.round(xrp * 1_000_000));
}

// ---------------- x402: services the buyer agent pays for, per call ----------------
//
// Each of these answers HTTP 402 with payment terms until it sees proof of an
// XRPL payment. The buyer agent settles them from its own funded account with
// no human in the loop — this is the machine-to-machine half of the product.

for (const service of SERVICES) {
  app.get(service.path, requirePayment(service), (req, res) => {
    res.json(service.handler(req));
  });
}

app.get("/api/paid/catalog", async (_req, res) => {
  res.json({
    payTo: await getMerchantAddress(),
    services: SERVICES.map((s) => ({
      id: s.id,
      priceXrp: s.priceXrp,
      description: s.description,
      path: s.path,
    })),
  });
});

// ---------------- Buyer: agent-sourced deals ----------------
//
// The agent does the sourcing, pays to verify candidates, negotiates, and
// stops at a recommendation. Approval stays with the buyer.

interface AgentRun {
  id: string;
  status: "running" | "awaiting_approval" | "done" | "failed";
  events: AgentLogEvent[];
  recommendation?: {
    supplierId: string;
    supplierName: string;
    unitPriceUSD: number;
    quantity: number;
    totalUSD: number;
    spendXrp: number;
    receipts: unknown[];
  };
  error?: string;
}

const agentRuns = new Map<string, AgentRun>();

app.post("/api/agent/source", (req, res) => {
  const { productName, quantity, maxBudgetUSD, autoApproveLimitUSD, deadlineDays } = req.body ?? {};
  if (!productName) return res.status(400).json({ error: "productName is required" });

  const qty = Number(quantity) || 100;
  const intent: BuyerIntent = {
    productName,
    quantity: qty,
    maxBudgetUSD: Number(maxBudgetUSD) || 4000,
    maxTargetUnitCostUSD: (Number(maxBudgetUSD) || 4000) / qty,
    deadlineDays: Number(deadlineDays) || 14,
    autoApproveLimitUSD: Number(autoApproveLimitUSD) || 500,
  };

  const run: AgentRun = { id: `RUN-${Date.now()}`, status: "running", events: [] };
  agentRuns.set(run.id, run);

  new TradeOrchestrator()
    .recommendDeal(intent, (e) => run.events.push(e))
    .then((result) => {
      if (!result) {
        run.status = "failed";
        run.error = "no supplier qualified";
        return;
      }
      run.status = "awaiting_approval";
      run.recommendation = {
        supplierId: result.supplier.supplierId,
        supplierName: result.supplier.supplierName,
        unitPriceUSD: result.agreedUnitPriceUSD,
        quantity: intent.quantity,
        totalUSD: result.totalUSD,
        spendXrp: result.spendXrp,
        receipts: result.receipts,
      };
    })
    .catch((err) => {
      run.status = "failed";
      run.error = err.message;
      console.error("[agent]", err);
    });

  res.json({ runId: run.id });
});

app.get("/api/agent/runs/:id", (req, res) => {
  const run = agentRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json(run);
});

// ---------------- Buyer: create + list deals ----------------

app.post("/api/deals", async (req, res) => {
  try {
    const { buyerContact, supplierContact, productName, amountUSD, deadlineDays } = req.body ?? {};
    if (!buyerContact || !supplierContact || !productName || !amountUSD) {
      return res.status(400).json({ error: "buyerContact, supplierContact, productName, and amountUSD are required" });
    }

    const deal = createDeal({
      buyerContact,
      supplierContact,
      productName,
      amountUSD: Number(amountUSD),
      deadlineDays: Number(deadlineDays) || 14,
    });

    res.json({ deal: toPublicDeal(deal), inviteUrl: `/supplier.html?token=${deal.inviteToken}` });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/deals", (req, res) => {
  const buyerContact = String(req.query.buyerContact || "");
  const deals = listDeals()
    .filter((d) => !buyerContact || d.buyerContact === buyerContact)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ deals: deals.map(toPublicDeal) });
});

app.get("/api/deals/:id", (req, res) => {
  const deal = getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: "not found" });
  res.json({ deal: toPublicDeal(deal) });
});

// Demo convenience: generates and funds a fresh testnet wallet so a supplier
// playing along doesn't need to already have one. Only the address is
// returned — receiving an EscrowFinish payout requires no signature from the
// recipient, so no seed needs to leave the server for this to work.
app.post("/api/testnet-address", async (req, res) => {
  const client = await getClient();
  try {
    const { wallet } = await client.fundWallet();
    res.json({ address: wallet.address });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await client.disconnect();
  }
});

// ---------------- Supplier: view invite, submit address, submit evidence ----------------

app.get("/api/invite/:token", (req, res) => {
  const deal = getDealByToken(req.params.token);
  if (!deal) return res.status(404).json({ error: "not found" });
  res.json({ deal: toPublicDeal(deal) });
});

app.post("/api/invite/:token/address", async (req, res) => {
  const deal = getDealByToken(req.params.token);
  if (!deal) return res.status(404).json({ error: "not found" });
  if (deal.status !== "AWAITING_SUPPLIER") {
    return res.status(409).json({ error: `Deal is already ${deal.status}` });
  }

  const { supplierAddress } = req.body ?? {};
  if (!supplierAddress) return res.status(400).json({ error: "supplierAddress is required" });
  if (!isValidAddress(String(supplierAddress).trim())) {
    return res.status(400).json({
      error: `"${supplierAddress}" isn't a valid XRPL address. It should start with "r" and be 25–35 characters — use the "Generate a testnet address for me" option if you don't have one.`,
    });
  }

  const client = await getClient();
  try {
    const buyerWallet = await getOrCreateBuyerWallet(client, deal.buyerContact);
    const { condition, fulfillment } = generateEscrowCondition();
    const cancelAfterUnixSeconds = Date.now() / 1000 + CANCEL_AFTER_SECONDS;

    const created = await createEscrow({
      client,
      fromWallet: buyerWallet,
      toAddress: supplierAddress,
      amountDrops: usdToDemoDrops(deal.amountUSD),
      condition,
      cancelAfterSeconds: CANCEL_AFTER_SECONDS,
      memo: { agent_id: "tideline-web", deal_id: deal.id, action: "lock_escrow" },
    });

    if (created.resultCode !== "tesSUCCESS") {
      return res.status(502).json({ error: `EscrowCreate failed: ${created.resultCode}` });
    }

    const updated = updateDeal(deal.id, {
      supplierAddress,
      buyerAddress: buyerWallet.address,
      escrowCondition: condition,
      escrowFulfillment: fulfillment,
      escrowSequence: created.sequence,
      escrowCreateTxHash: created.txHash,
      cancelAfterUnixSeconds,
      status: "LOCKED",
    });

    res.json({ deal: toPublicDeal(updated) });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await client.disconnect();
  }
});

/**
 * Carries out a release-or-refund-pending decision on XRPL and records it.
 * Shared by the automatic path (AI/fallback verdict) and the manual-decision
 * endpoint (a human standing in when the agent couldn't judge it itself) —
 * same settlement mechanics either way, only who made the call differs.
 */
async function settleDeal(
  client: Client,
  deal: DealRecord,
  decision: { passed: boolean; reasoning: string; method: "ai" | "fallback" | "manual" }
) {
  if (decision.passed) {
    if (!deal.escrowCondition || !deal.escrowFulfillment || deal.escrowSequence === undefined || !deal.buyerAddress) {
      throw new Error("Missing escrow context — cannot finish escrow");
    }
    const verifierWallet = await getOrCreateVerifierWallet(client);
    const finished = await finishEscrow({
      client,
      submitterWallet: verifierWallet,
      ownerAddress: deal.buyerAddress,
      sequence: deal.escrowSequence,
      condition: deal.escrowCondition,
      fulfillment: deal.escrowFulfillment,
      memo: { agent_id: "tideline-web", deal_id: deal.id, action: `release_${decision.method}` },
    });
    return updateDeal(deal.id, {
      status: finished.resultCode === "tesSUCCESS" ? "RELEASED" : "UNDER_REVIEW",
      escrowFinishTxHash: finished.txHash,
      verification: { passed: true, reasoning: decision.reasoning, method: decision.method },
    });
  } else {
    return updateDeal(deal.id, {
      status: "REFUND_PENDING",
      verification: { passed: false, reasoning: decision.reasoning, method: decision.method },
    });
  }
}

app.post("/api/invite/:token/evidence", upload.single("photo"), async (req, res) => {
  const deal = getDealByToken(req.params.token);
  if (!deal) return res.status(404).json({ error: "not found" });
  if (deal.status !== "LOCKED") {
    return res.status(409).json({ error: `Deal is not awaiting evidence (status: ${deal.status})` });
  }

  const { trackingNumber, note } = req.body ?? {};
  const file = (req as any).file as Express.Multer.File | undefined;

  updateDeal(deal.id, {
    status: "UNDER_REVIEW",
    evidence: { trackingNumber: trackingNumber || "", note: note || "", imagePath: file ? `/uploads/${file.filename}` : undefined },
  });

  let imageBase64: string | undefined;
  let imageMediaType: string | undefined;
  if (file) {
    imageBase64 = fs.readFileSync(file.path).toString("base64");
    imageMediaType = file.mimetype;
  }

  const verdict = await reviewEvidence({
    productName: deal.productName,
    amountUSD: deal.amountUSD,
    quantityDescription: deal.productName,
    trackingNumber: trackingNumber || "",
    note: note || "",
    imageBase64,
    imageMediaType,
  });

  if (verdict.needsManualReview) {
    const updated = updateDeal(deal.id, {
      status: "NEEDS_MANUAL_REVIEW",
      verification: { passed: null, reasoning: verdict.reasoning, method: verdict.method },
    });
    return res.json({ deal: toPublicDeal(updated), verdict });
  }

  const client = await getClient();
  try {
    const updated = await settleDeal(client, deal, { passed: verdict.passed, reasoning: verdict.reasoning, method: verdict.method });
    return res.json({ deal: toPublicDeal(updated), verdict });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await client.disconnect();
  }
});

// A human stands in exactly where the agent said it couldn't judge for
// itself (status NEEDS_MANUAL_REVIEW) — e.g. a submitted photo with no
// vision model configured. Same settlement mechanics as the automatic path.
app.post("/api/deals/:id/manual-decision", async (req, res) => {
  const deal = getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: "not found" });
  if (deal.status !== "NEEDS_MANUAL_REVIEW") {
    return res.status(409).json({ error: `Deal is not awaiting manual review (status: ${deal.status})` });
  }

  const { approve, reasoning } = req.body ?? {};
  if (typeof approve !== "boolean") return res.status(400).json({ error: "approve (boolean) is required" });

  const client = await getClient();
  try {
    const updated = await settleDeal(client, deal, {
      passed: approve,
      reasoning: reasoning || `Manually ${approve ? "approved" : "rejected"} by the buyer.`,
      method: "manual",
    });
    res.json({ deal: toPublicDeal(updated) });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await client.disconnect();
  }
});

// Manual refund trigger (demo stand-in for a scheduled job that would fire
// once CancelAfter actually elapses — XRPL itself rejects this until then).
app.post("/api/deals/:id/refund", async (req, res) => {
  const deal = getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: "not found" });
  if (deal.status !== "REFUND_PENDING") {
    return res.status(409).json({ error: `Deal is not pending refund (status: ${deal.status})` });
  }
  if (deal.escrowSequence === undefined) return res.status(500).json({ error: "missing escrow sequence" });

  const client = await getClient();
  try {
    const buyerWallet = await getOrCreateBuyerWallet(client, deal.buyerContact);
    const cancelled = await cancelEscrow({
      client,
      ownerWallet: buyerWallet,
      sequence: deal.escrowSequence,
      memo: { agent_id: "tideline-web", deal_id: deal.id, action: "refund_after_failed_verification" },
    });

    const updated = updateDeal(deal.id, {
      status: cancelled.resultCode === "tesSUCCESS" ? "REFUNDED" : "REFUND_PENDING",
      escrowCancelTxHash: cancelled.txHash,
    });

    res.json({ deal: toPublicDeal(updated), resultCode: cancelled.resultCode });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await client.disconnect();
  }
});

app.listen(PORT, () => {
  console.log(`Tideline server listening on http://localhost:${PORT}`);
  console.log(`ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "set — AI evidence review enabled" : "not set — using fallback rule-based review"}`);
});
