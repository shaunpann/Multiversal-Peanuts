import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import express from "express";
import type { Deal } from "../shared/types.js";
import { bus } from "../shared/events.js";
import { approvals } from "../shared/approvals.js";
import { policyEngine } from "../shared/policy.js";
import { DEMO_MANDATE, SUPPLIERS } from "../shared/fixtures.js";
import { SERVICES } from "../x402/services.js";
import { requirePayment } from "../x402/middleware.js";
import { resetPaidCalls } from "../x402/client.js";
import { accountUrl, getBalanceXrp, getWallets } from "../xrpl/client.js";
import { selfTest } from "../xrpl/conditions.js";
import { cancelMilestone, createMilestoneEscrows, escrowsFor, releaseMilestone, resetEscrows } from "../xrpl/escrow.js";
import { getDeal, runDeal } from "../agents/buyer.js";
import { evaluateMilestone } from "../agents/verification.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

/* ---------- frontend ---------- */
app.use(express.static(path.join(here, "..", "frontend")));

/* ---------- live event stream ---------- */
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of bus.history()) res.write(`data: ${JSON.stringify(event)}\n\n`);
  const onEvent = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  bus.on("event", onEvent);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off("event", onEvent);
  });
});

/* ---------- free discovery ---------- */
app.get("/api/suppliers", (_req, res) => {
  res.json(SUPPLIERS.map(({ hidden: _hidden, ...rest }) => rest));
});

/* ---------- x402 paid services ---------- */
for (const service of SERVICES) {
  app.get(service.path, requirePayment(service), (req, res) => {
    res.json(service.handler(req));
  });
}

/* ---------- settlement API (the A -> B boundary) ---------- */
app.post("/settlement/create", async (req, res) => {
  try {
    const { deal } = req.body as { deal: Deal };
    if (!deal?.approvedByHuman) {
      res.status(403).json({ error: "deal has not been approved by a human" });
      return;
    }
    const escrows = await createMilestoneEscrows(deal);
    res.json({ dealId: deal.dealId, escrows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/settlement/release", async (req, res) => {
  try {
    const { dealId, milestoneId } = req.body as { dealId: string; milestoneId: string };
    const record = await releaseMilestone(dealId, milestoneId);
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/settlement/cancel", async (req, res) => {
  try {
    const { dealId, milestoneId } = req.body as { dealId: string; milestoneId: string };
    res.json(await cancelMilestone(dealId, milestoneId));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.get("/settlement/:dealId", (req, res) => {
  res.json({ dealId: req.params.dealId, escrows: escrowsFor(req.params.dealId ?? "") });
});

/* ---------- demo control ---------- */
app.post("/run", (_req, res) => {
  bus.reset();
  resetEscrows();
  resetPaidCalls();
  approvals.reset();
  policyEngine.reset();
  runDeal(DEMO_MANDATE).catch((err) => {
    bus.emitEvent("system", "error", `Run failed: ${String(err)}`);
  });
  res.json({ started: true });
});

app.post("/approve", (req, res) => {
  const { id, approved } = req.body as { id: string; approved: boolean };
  res.json({ resolved: approvals.resolve(id, approved) });
});

/** The "before and after" moment: a simulated carrier webhook. */
app.post("/webhook/logistics", async (req, res) => {
  const deal = getDeal();
  if (!deal) {
    res.status(400).json({ error: "no active deal" });
    return;
  }
  const milestoneId = (req.body as { milestoneId?: string }).milestoneId ?? "delivery";
  const evidence =
    milestoneId === "delivery"
      ? { type: "carrier_webhook", status: "delivered", trackingRef: "WIRA-8827411" }
      : { type: "workshop_photos", photos: 6 };

  bus.emitEvent("system", "webhook_received", `Carrier webhook received for '${milestoneId}'`, {
    data: evidence,
  });
  const result = await evaluateMilestone(deal, milestoneId, evidence);
  res.json(result);
});

app.get("/state", async (_req, res) => {
  const deal = getDeal();
  const wallets = await getWallets();
  res.json({
    deal,
    escrows: deal ? escrowsFor(deal.dealId) : [],
    receipts: policyEngine.ledger(),
    policy: policyEngine.policy,
    spentXrp: policyEngine.spentXrp,
    callCount: policyEngine.callCount,
    approvals: approvals.list(),
    mandate: DEMO_MANDATE,
    wallets: {
      buyer: { address: wallets.buyer.address, url: accountUrl(wallets.buyer.address) },
      agent: { address: wallets.agent.address, url: accountUrl(wallets.agent.address) },
      supplier: { address: wallets.supplier.address, url: accountUrl(wallets.supplier.address) },
      merchant: { address: wallets.merchant.address, url: accountUrl(wallets.merchant.address) },
    },
  });
});

const PORT = Number(process.env.PORT ?? 3000);

async function boot(): Promise<void> {
  if (!selfTest()) throw new Error("crypto-condition encoding self-test failed");
  const wallets = await getWallets();
  const agentBalance = await getBalanceXrp(wallets.agent.address);
  bus.emitEvent(
    "system",
    "ready",
    `Agent allowance: ${agentBalance} XRP. The agent cannot spend more than this - ` +
      "its authority is a funded account, not a config value.",
  );
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`\n  Dashboard  http://localhost:${PORT}\n`);
  });
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("boot failed:", err);
  process.exit(1);
});
