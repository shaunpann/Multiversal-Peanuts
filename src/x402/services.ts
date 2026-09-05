// src/x402/services.ts
//
// The services the buyer agent buys, per call, on its own authority. These
// are the "Agent/API fees" revenue line: small, machine-priced, and consumed
// by software rather than a person. In production each handler calls a real
// registry, freight API or customs classifier — the payment layer above them
// does not change.

import { Request } from "express";
import { SUPPLIER_RECORDS, MOCK_SUPPLIERS } from "../tools/mockData";

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
    path: "/api/paid/verify-business/:supplierId",
    priceXrp: 0.25,
    description: "Company registry, dispute history and trading record for one supplier",
    handler: (req) => {
      const supplier = MOCK_SUPPLIERS.find((s) => s.supplierId === req.params.supplierId);
      const record = SUPPLIER_RECORDS[req.params.supplierId];
      if (!supplier || !record) return { error: "unknown supplier" };

      const passed = record.registration === "active" && record.openDisputes === 0;
      return {
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        ...record,
        verdict: passed ? "pass" : "fail",
        reason: passed
          ? `Registration active, no open disputes, ${record.yearsTrading} years trading.`
          : `Registration ${record.registration}, ${record.openDisputes} open dispute(s).`,
      };
    },
  },
  {
    id: "freight-quote",
    path: "/api/paid/freight-quote",
    priceXrp: 0.1,
    description: "Cross-border freight rates and transit times",
    handler: () => ({
      options: [
        { carrier: "Wira Logistics", transitDays: 3, costUSD: 410 },
        { carrier: "DHL Express", transitDays: 2, costUSD: 620 },
      ],
      recommended: "Wira Logistics",
    }),
  },
  {
    id: "customs-check",
    path: "/api/paid/customs-check",
    priceXrp: 0.1,
    description: "HS classification and duty exposure for the shipment",
    handler: () => ({
      hsCode: "8536.90",
      dutyRatePct: 0,
      notes: "Preferential rate applies with a certificate of origin.",
    }),
  },
];
