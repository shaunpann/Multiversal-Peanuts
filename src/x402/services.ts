// src/x402/services.ts
//
// The services the buyer agent buys, per call, on its own authority. These
// are the "Agent/API fees" revenue line: small, machine-priced, and consumed
// by software rather than a person. In production each handler calls a real
// registry, freight API or customs classifier — the payment layer above them
// does not change.

import { Request } from "express";
import { registryLookup } from "../tools/mockData";

export interface PaidService {
  id: string;
  path: string;
  priceXrp: number;
  description: string;
  handler: (req: Request) => unknown;
}

export const SERVICES: PaidService[] = [
  {
    id: "verify-business",
    // Keyed by company name, because the buyer brings the supplier — there is
    // no catalogue of ids to look them up in.
    path: "/api/paid/verify-business/:supplierName",
    priceXrp: 0.25,
    description: "Company registry, dispute history and trading record for one supplier",
    handler: (req) => {
      const supplierName = decodeURIComponent(req.params.supplierName || "").trim();
      if (!supplierName) return { error: "supplier name is required" };
      const record = registryLookup(supplierName);

      // Fail on any of: lapsed registration, an open dispute, a sanctions
      // hit, or a company too thinly capitalised to stand behind the order.
      const flags: string[] = [];
      if (record.registration === "lapsed") flags.push(`registration lapsed (last filing ${record.lastFiling})`);
      if (record.openDisputes > 0) flags.push(record.disputeDetail ?? `${record.openDisputes} open dispute(s)`);
      if (record.onSanctionsList) flags.push("appears on a sanctions list");
      if (record.paidUpCapitalUSD < 10_000) flags.push(`paid-up capital only US$${record.paidUpCapitalUSD.toLocaleString()}`);

      const passed = flags.length === 0;
      return {
        supplierName,
        ...record,
        verdict: passed ? "pass" : "fail",
        reason: passed
          ? `Registration active since ${record.incorporated}, no open disputes, ` +
            `${record.yearsTrading} years trading, ${record.tradeReferences} trade references, credit band ${record.creditBand}.`
          : flags.join("; ") + ".",
      };
    },
  },
  {
    id: "freight-quote",
    path: "/api/paid/freight-quote",
    priceXrp: 0.1,
    description: "Cross-border freight rates and transit times",
    handler: () => ({
      lane: "Shenzhen / Dongguan → Singapore",
      incoterm: "FOB origin, buyer books freight",
      options: [
        { carrier: "Wira Logistics", mode: "LCL sea", transitDays: 9, costUSD: 410, insurance: "included to US$5,000" },
        { carrier: "Straits Freight", mode: "LCL sea", transitDays: 7, costUSD: 545, insurance: "included to US$10,000" },
        { carrier: "DHL Express", mode: "air", transitDays: 2, costUSD: 1_180, insurance: "included to US$25,000" },
      ],
      recommended: "Straits Freight",
      recommendationReason: "7 days keeps the 21-day deadline with margin at 46% of the air rate.",
    }),
  },
  {
    id: "customs-check",
    path: "/api/paid/customs-check",
    priceXrp: 0.1,
    description: "HS classification and duty exposure for the shipment",
    handler: () => ({
      hsCode: "8538.90",
      description: "Parts suitable for use solely with the apparatus of heading 85.35–85.37",
      destination: "Singapore",
      dutyRatePct: 0,
      gstRatePct: 9,
      preferentialScheme: "ASEAN–China FTA",
      requiredDocs: ["Form E certificate of origin", "commercial invoice", "packing list"],
      notes:
        "Singapore levies no import duty on this heading; 9% GST applies on CIF value and is " +
        "recoverable for a GST-registered importer. Form E must be issued at origin.",
    }),
  },
];
