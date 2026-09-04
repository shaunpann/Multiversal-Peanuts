import crypto from "node:crypto";
import { z } from "zod";
import type { Deal, Mandate, Quote, Supplier } from "../shared/types.js";
import { bus } from "../shared/events.js";
import { approvals } from "../shared/approvals.js";
import { policyEngine } from "../shared/policy.js";
import { DEMO_MILESTONES, SUPPLIERS } from "../shared/fixtures.js";
import { callPaidService } from "../x402/client.js";
import { getWallets } from "../xrpl/client.js";
import { SupplierAgent } from "./supplier.js";
import { think } from "./llm.js";

const BASE_URL = () => `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const DEAL_XRP = Number(process.env.DEAL_XRP ?? 6);

interface VerificationResult {
  supplierId: string;
  verdict: "pass" | "fail";
  reason: string;
}

const CounterSchema = z.object({
  unitPrice: z.number(),
  rationale: z.string(),
});

let currentDeal: Deal | undefined;
export function getDeal(): Deal | undefined {
  return currentDeal;
}

/**
 * Tier 1 decisions - shortlist, what to buy, which supplier wins - are the
 * agent's alone. Only the finished deal goes to a human, and by then the
 * candidates have already been narrowed using information the agent bought.
 */
export async function runDeal(mandate: Mandate): Promise<Deal> {
  policyEngine.reset();
  bus.emitEvent("buyer_agent", "mandate_received", mandate.prompt, { data: { ...mandate } });

  const candidates = discover(mandate);
  const chosen = await selectSupplier(candidates);
  if (!chosen) throw new Error("no supplier satisfied the mandate");

  const agreed = await negotiate(chosen, mandate);
  await priceTheLogistics(chosen);

  const wallets = await getWallets();
  const deal: Deal = {
    dealId: `TX-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    mandate,
    supplierId: chosen.id,
    supplierName: chosen.name,
    buyerAddress: wallets.buyer.address,
    supplierAddress: wallets.supplier.address,
    displayTotal: agreed.total,
    displayCurrency: "SGD",
    amountXrp: DEAL_XRP,
    milestones: DEMO_MILESTONES,
    approvedByHuman: false,
    status: "awaiting_approval",
  };
  currentDeal = deal;

  const approved = await approvals.request(
    "deal",
    `Approve S$${agreed.total.toLocaleString()} with ${chosen.name} ` +
      `(${mandate.units} units at S$${agreed.unitPrice}), released across ${deal.milestones.length} milestones?`,
    {
      dealId: deal.dealId,
      supplier: chosen.name,
      total: agreed.total,
      unitPrice: agreed.unitPrice,
      amountXrp: deal.amountXrp,
      milestones: deal.milestones,
      agentSpendXrp: policyEngine.spentXrp,
    },
  );

  if (!approved) {
    deal.status = "failed";
    bus.emitEvent("buyer_agent", "deal_declined", "Buyer declined the recommended deal. Nothing was escrowed.");
    return deal;
  }

  deal.approvedByHuman = true;
  deal.status = "settling";

  const response = await fetch(`${BASE_URL()}/settlement/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deal }),
  });
  if (!response.ok) {
    deal.status = "failed";
    throw new Error(`settlement/create failed: ${response.status} ${await response.text()}`);
  }

  deal.status = "active";
  bus.emitEvent("buyer_agent", "deal_active", `${deal.dealId} is funded and running.`);
  return deal;
}

function discover(mandate: Mandate): Supplier[] {
  const candidates = SUPPLIERS.filter((s) => s.unitPrice <= mandate.maxUnitPrice).sort(
    (a, b) => a.unitPrice - b.unitPrice,
  );
  bus.emitEvent(
    "buyer_agent",
    "suppliers_discovered",
    `Found ${candidates.length} suppliers within the S$${mandate.maxUnitPrice}/unit mandate: ` +
      candidates.map((s) => `${s.name} (S$${s.unitPrice})`).join(", "),
    { data: { candidates: candidates.map((s) => ({ id: s.id, name: s.name, unitPrice: s.unitPrice })) } },
  );
  return candidates;
}

/**
 * The moment worth demoing: the agent pays for information, and the cheapest
 * option loses on what the agent learns. Nobody approves these payments.
 */
async function selectSupplier(candidates: Supplier[]): Promise<Supplier | undefined> {
  for (const candidate of candidates) {
    bus.emitEvent(
      "buyer_agent",
      "checking_supplier",
      `${candidate.name} is the cheapest remaining option at S$${candidate.unitPrice}/unit. Verifying before committing.`,
    );

    const result = await callPaidService<VerificationResult>(
      "verify-business",
      `/api/verify-business/${candidate.id}`,
      `Decides whether ${candidate.name} is eligible at all`,
    );

    if (!result.ok || !result.data) {
      bus.emitEvent("buyer_agent", "verification_unavailable", `Could not verify ${candidate.name}: ${result.reason}`);
      continue;
    }

    if (result.data.verdict === "fail") {
      bus.emitEvent(
        "buyer_agent",
        "supplier_rejected",
        `Rejected ${candidate.name} despite the lowest price - ${result.data.reason}`,
        { data: { supplierId: candidate.id } },
      );
      continue;
    }

    bus.emitEvent(
      "buyer_agent",
      "supplier_selected",
      `Selected ${candidate.name} - ${result.data.reason}`,
      { data: { supplierId: candidate.id } },
    );
    return candidate;
  }
  return undefined;
}

async function negotiate(supplier: Supplier, mandate: Mandate): Promise<Quote> {
  const counterparty = new SupplierAgent(supplier);
  let quote = counterparty.openingQuote(mandate.units);
  const target = Math.round(supplier.unitPrice * 0.93);

  for (let round = 1; round <= 3; round += 1) {
    if (quote.unitPrice <= target) break;

    const llm = await think(
      CounterSchema,
      "You are a procurement agent for a Singapore interior-design firm. Negotiate firmly but " +
        "credibly on unit price. You may offer immediate escrowed settlement as leverage.",
      `Mandate: ${mandate.units} ${mandate.product}, at most S$${mandate.maxUnitPrice}/unit, ` +
        `delivered in ${mandate.deliveryDays} days. Current offer: S$${quote.unitPrice}/unit ` +
        `(${quote.note}). Round ${round} of 3. Propose one counter unit price.`,
    );

    const counterPrice = llm
      ? Math.min(quote.unitPrice - 1, Math.round(llm.unitPrice))
      : Math.max(target - 5, Math.round(quote.unitPrice * 0.94));

    bus.emitEvent(
      "buyer_agent",
      "counter_offer",
      `Counter-offer S$${counterPrice}/unit${llm ? ` - ${llm.rationale}` : " for immediate escrowed settlement"}`,
      { data: { round, counterPrice } },
    );

    quote = await counterparty.respondTo(counterPrice, mandate.units);
  }

  bus.emitEvent(
    "buyer_agent",
    "terms_agreed",
    `Terms agreed with ${supplier.name}: ${mandate.units} units at S$${quote.unitPrice} = S$${quote.total.toLocaleString()}`,
    { data: { ...quote } },
  );
  return quote;
}

async function priceTheLogistics(supplier: Supplier): Promise<void> {
  await callPaidService("freight-quote", "/api/freight-quote", "Sets the landed cost and delivery milestone date");
  await callPaidService("customs-check", "/api/customs-check", `Confirms duty exposure for ${supplier.country} origin`);
}
